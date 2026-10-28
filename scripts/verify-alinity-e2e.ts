/**
 * Abbott Alinity end-to-end over real sockets, through the production engine.
 *
 * A fake Alinity plays both of its channels: it dials Synapse's listening port
 * (its "sender" channel) and listens on an order port of its own (its "receiver"
 * channel, which Synapse dials). Then, in the order the analyzer would:
 *   1. TCU^U10 assay list  -> ACK^U10, assay numbers learned onto the mappings
 *   2. QBP^Q11 for S100001 -> RSP^K11 on the sender channel, then OML^O33 with
 *                             TSH + FT4 (by learned number) on the ORDER channel
 *   3. ORL^O34 accept      -> order-response monitor event
 *   4. QBP^Q11 for unknown -> negative query response (ORC DC) on the order channel
 *   5. OUL^R22 result      -> ACK^R22, result decoded under the barcode
 *   6. NMD^N02 on the ORDER channel -> ACK^N02 there
 *
 * Run:  npm run verify:alinity-e2e
 */
import net from 'node:net'
import { Orchestrator } from '../src/main/core/engine/Orchestrator'
import { MockLisRepository } from '../src/main/core/lis/MockLisRepository'
import { Hl7Protocol } from '../src/main/core/protocols/hl7'
import type { MonitorEvent } from '../src/shared/types'

let passed = 0
let failed = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? `  (${detail})` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
}

const CR = '\r'
const SYNAPSE_PORT = 19160
const ORDER_PORT = 19161
const frame = (segs: string[]): Buffer => Hl7Protocol.frame(segs.join(CR) + CR)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Collects MLLP frames arriving on a socket. */
function collector(socket: net.Socket): { next: (pred?: (t: string) => boolean, ms?: number) => Promise<string[]> } {
  const proto = new Hl7Protocol()
  const queue: string[][] = []
  const waiters: { pred: (t: string) => boolean; resolve: (s: string[]) => void }[] = []
  socket.on('data', (chunk) => {
    for (const m of proto.feed(chunk)) {
      const segs = m.records.map((r) => r.join('|'))
      const type = (m.records.find((r) => r[0] === 'MSH')?.[8] ?? '').toUpperCase()
      const i = waiters.findIndex((w) => w.pred(type))
      if (i >= 0) waiters.splice(i, 1)[0].resolve(segs)
      else queue.push(segs)
    }
  })
  return {
    next: (pred = () => true, ms = 4000) =>
      new Promise((resolve, reject) => {
        const qi = queue.findIndex((segs) => pred((segs[0] ?? '').split('|')[8] ?? ''))
        if (qi >= 0) return resolve(queue.splice(qi, 1)[0])
        const t = setTimeout(() => reject(new Error(`timed out waiting for a frame (${ms}ms)`)), ms)
        waiters.push({
          pred,
          resolve: (s) => {
            clearTimeout(t)
            resolve(s)
          }
        })
      })
  }
}

async function main(): Promise<void> {
  const orch = new Orchestrator(new MockLisRepository())
  const monitor: MonitorEvent[] = []
  orch.on('monitor', (e: MonitorEvent) => monitor.push(e))

  // --- the fake analyzer's receiver channel (Synapse dials this) -------------
  let orderSocket: net.Socket | null = null
  let orderRx: ReturnType<typeof collector> | null = null
  const orderServer = net.createServer((s) => {
    orderSocket = s
    orderRx = collector(s)
  })
  await new Promise<void>((r) => orderServer.listen(ORDER_PORT, '127.0.0.1', r))

  console.log('\n[1] Onboard an Alinity ci: listens on the sender port, dials the order port')
  const rt = await orch.addInstrument({
    name: 'Alinity ci (e2e)',
    driverId: 'abbott-alinity-ci',
    protocol: 'hl7',
    enabled: true,
    connection: {
      transport: 'tcp-server',
      host: '0.0.0.0',
      port: SYNAPSE_PORT,
      hostQuery: true,
      orderChannel: { transport: 'tcp-client', host: '127.0.0.1', port: ORDER_PORT }
    }
  })
  eq('instrument listening', rt.status, 'listening')
  for (let i = 0; i < 40 && !orderSocket; i++) await sleep(50)
  ok('Synapse dialled the analyzer order port', !!orderSocket)
  const rules = orch.mapping.list().filter((r) => r.driverId === 'abbott-alinity-ci')
  ok('catalog analytes seeded', rules.length > 20)
  eq('TSH seeded without an assay number yet', rules.find((r) => r.instrumentCode === 'TSH')?.analyzerCode, undefined)

  // --- the fake analyzer's sender channel (dials Synapse) --------------------
  const sender = net.connect(SYNAPSE_PORT, '127.0.0.1')
  await new Promise<void>((r) => sender.once('connect', () => r()))
  const rx = collector(sender)
  await sleep(100)
  eq('instrument online once the analyzer connects', await instrumentStatus(orch, rt.id), 'online')

  console.log('\n[2] TCU^U10 assay list: acknowledged, assay numbers learned')
  sender.write(
    frame([
      'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120000-0500||TCU^U10^TCU_U10|tcu-1|P|2.5.1|||NE|AL||UNICODE UTF-8',
      'EQU|Alinity ci-series^Abbott~SCM00181^Abbott|20250101120000',
      'TCC|248^TSH^99ABT|248||||||||||||A^Available^99ABT',
      'TCC|301^FT4^99ABT|301||||||||||||A^Available^99ABT',
      'TCC|658^B-hCG^99ABT|658||||||||||||A^Available^99ABT',
      'TCC|488^Estradiol^99ABT|488||||||||||||U^Unavailable^99ABT'
    ])
  )
  const ack10 = await rx.next((t) => t.startsWith('ACK^U10'))
  eq('ACK^U10 on the sender channel', ack10[1], 'MSA|AA|tcu-1')
  await sleep(100)
  const after = orch.mapping.list().filter((r) => r.driverId === 'abbott-alinity-ci')
  eq('TSH now carries assay 248', after.find((r) => r.instrumentCode === 'TSH')?.analyzerCode, '248')
  eq('FT4 now carries assay 301', after.find((r) => r.instrumentCode === 'FT4')?.analyzerCode, '301')
  const bhcg = after.find((r) => r.instrumentCode.toUpperCase() === 'B-HCG')
  ok('B-hCG learned (seeded or new row) with 658', bhcg?.analyzerCode === '658')

  console.log('\n[3] QBP^Q11 for S100001 (TSH + FT4 ordered in the mock LIS)')
  sender.write(
    frame([
      'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120100||QBP^Q11^QBP_Q11|q-1|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-27^IHE',
      'QPD|WOS^Work Order Step^IHELAW|87|S100001',
      'RCP|I||R^Real Time^HL70394'
    ])
  )
  const rsp = await rx.next((t) => t.startsWith('RSP^K11'))
  eq('RSP^K11 receipt on the sender channel', rsp[1], 'MSA|AA|q-1')
  eq('  QAK echoes the query tag', rsp[2], 'QAK|87|OK|WOS^Work Order Step^IHELAW')
  ok('  our MSH-3/4 echo the analyzer\'s MSH-5/6', rsp[0].startsWith('MSH|^~\\&|LIS|MainLab|Alinity ci|Lab2|'))
  const oml = await orderRx!.next((t) => t.startsWith('OML^O33'))
  ok('OML^O33 arrives on the ORDER channel', true)
  ok('  LAB-28 profile', oml[0].endsWith('|||LAB-28^IHE'))
  eq('  patient specimen', oml.find((s) => s.startsWith('SPM|')), 'SPM|1|||""|||||||P^Patient^HL70369')
  eq('  barcode in SAC-3', oml.find((s) => s.startsWith('SAC|')), 'SAC|||S100001')
  const obrs = oml.filter((s) => s.startsWith('OBR|'))
  eq('  two tests ordered', obrs.length, 2)
  const assayNos = obrs.map((s) => s.split('|')[4].split('^')[0]).sort()
  eq('  by learned assay number (248 TSH, 301 FT4)', assayNos.join(','), '248,301')
  ok('  each with an AWOS id', obrs.every((s) => /^OBR\|\|S100001-\d+-\d{14}\|\|/.test(s)))
  const ordered = monitor.find((e) => e.stage === 'ordered' && e.sampleId === 'S100001')
  ok('  "ordered" monitor event', !!ordered && /TSH \(248\)/.test(ordered.mappedTo ?? ''))

  console.log('\n[4] ORL^O34 from the analyzer on the order channel')
  const omlCtrl = oml[0].split('|')[9]
  const awos = obrs.map((s) => s.split('|')[2])
  orderSocket!.write(
    frame([
      `MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120101||ORL^O34^ORL_O42|orl-1|P|2.5.1||||||UNICODE UTF-8|||LAB-28^IHE`,
      `MSA|AA|${omlCtrl}`,
      'SPM|1|||""|||||||P^Patient^HL70369',
      'SAC|||S100001',
      `ORC|OK|${awos[0]}|||SC`,
      `ORC|UA|${awos[1]}|||CA`
    ])
  )
  await sleep(200)
  const orl = monitor.find((e) => e.analyteCode === 'ORDER' && e.sampleId === 'S100001')
  ok('order-response monitor event', !!orl)
  ok('  reports 1 accepted, 1 rejected', /1 accepted, 1 rejected/.test(orl?.message ?? ''), orl?.message)

  console.log('\n[5] QBP^Q11 for a barcode the LIS does not know -> negative query response')
  sender.write(
    frame([
      'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120200||QBP^Q11^QBP_Q11|q-2|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-27^IHE',
      'QPD|WOS^Work Order Step^IHELAW|88|NOPE123',
      'RCP|I||R^Real Time^HL70394'
    ])
  )
  const rsp2 = await rx.next((t) => t.startsWith('RSP^K11'))
  eq('RSP^K11 for the unknown barcode', rsp2[1], 'MSA|AA|q-2')
  const neg = await orderRx!.next((t) => t.startsWith('OML^O33'))
  eq('  negative response: unknown specimen role', neg[1], 'SPM|1|||""|||||||U^Unknown^HL70369')
  eq('  negative response: the queried barcode', neg[2], 'SAC|||NOPE123')
  ok('  negative response: ORC DC, no OBR', neg[3].startsWith('ORC|DC||||||||') && !neg.some((s) => s.startsWith('OBR|')))

  console.log('\n[6] OUL^R22 result upload -> ACK^R22 and a decoded result')
  sender.write(
    frame([
      'MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120300||OUL^R22^OUL_R22|r-1|P|2.5.1|||NE|AL||UNICODE UTF-8|||LAB-29^IHE',
      'SPM|1|||""|||||||P^Patient^HL70369',
      'SAC|||S100001|||||||S5501|1||||1^Position^99ABT~1^Module^99ABT',
      `OBR||${awos[0]}||248^TSH^99ABT`,
      'ORC|SC||||CM',
      'TQ1|||||||||R^Routine^HL70485',
      'OBX|1|ST|248^TSH^99ABT|1|2.41|^uIU/mL|0.35 - 4.94|""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20250101120259||||||||||RSLT',
      'TCD|248^TSH^99ABT||||||||||UNDILUTED^^99ABT',
      'OBX|2|ST|248.R^TSH^99ABT^S_RAW^Raw Supplemental^IHELAW|1|95007|^RLU||""|||F|||||Admin~Admin||Alinity ci-series^Abbott~i00002^Abbott|20250101120259||||||||||RSLT'
    ])
  )
  const ack22 = await rx.next((t) => t.startsWith('ACK^R22'))
  eq('ACK^R22 on the sender channel', ack22[1], 'MSA|AA|r-1')
  ok('  LAB-29 profile echoed', ack22[0].endsWith('|||LAB-29^IHE'))
  await sleep(300)
  const decoded = monitor.find((e) => e.stage === 'decoded' && e.sampleId === 'S100001')
  ok('result decoded under the barcode', !!decoded)
  eq('  analyte TSH', decoded?.analyteCode, 'TSH')
  eq('  value 2.41', decoded?.value, '2.41')
  eq('  unit from OBX-6.2', decoded?.unit, 'uIU/mL')
  ok('  raw RLU row not a result', !monitor.some((e) => e.stage === 'decoded' && e.value === '95007'))
  const written = monitor.find((e) => (e.stage === 'written' || e.stage === 'mapped') && e.sampleId === 'S100001' && e.analyteCode === 'TSH')
  ok('  mapped/written to the mock LIS TSH order', !!written, monitor.filter((e) => e.sampleId === 'S100001').map((e) => `${e.stage}:${e.message ?? ''}`).join(' | '))

  console.log('\n[7] Connection test from the analyzer on the ORDER channel')
  orderSocket!.write(
    frame(['MSH|^~\\&|Alinity ci|Lab2|LIS|MainLab|20250101120400||NMD^N02^NMD_N02|nmd-1|P|2.5.1|||NE|AL||UNICODE UTF-8', 'NST|N'])
  )
  const ackN = await orderRx!.next((t) => t.startsWith('ACK^N02'))
  eq('ACK^N02 on the order channel', ackN[1], 'MSA|AA|nmd-1')

  console.log('\n[8] Stop closes both channels')
  await orch.stopInstrument(rt.id)
  await sleep(150)
  ok('order socket closed by Synapse', !!orderSocket && (orderSocket as net.Socket).readableEnded)

  sender.destroy()
  orderServer.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  process.exit(0)
}

async function instrumentStatus(orch: Orchestrator, id: string): Promise<string> {
  return orch.listInstruments().find((i) => i.id === id)?.status ?? '?'
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
