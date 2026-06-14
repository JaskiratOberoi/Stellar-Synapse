import { useEffect, useMemo, useState } from 'react'
import { Search, Check, Ban } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { LisParameter, LisTest, MappingRule } from '@shared/types'

export function MappingEditor({
  rule,
  onClose
}: {
  rule: MappingRule | null
  onClose: () => void
}) {
  const tests = useAppStore((s) => s.tests)
  const parameters = useAppStore((s) => s.parameters)
  const [search, setSearch] = useState('')
  const [selTest, setSelTest] = useState<LisTest | null>(null)
  const [selParam, setSelParam] = useState<LisParameter | null>(null)
  const [unit, setUnit] = useState('')

  useEffect(() => {
    if (rule) {
      setSelTest(tests.find((t) => t.id === rule.lisTestId) ?? null)
      setSelParam(parameters.find((p) => p.id === rule.lisParamId) ?? null)
      setUnit(rule.unit ?? '')
      setSearch('')
    }
  }, [rule, tests, parameters])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tests.slice(0, 50)
    return tests.filter(
      (t) => t.testName.toLowerCase().includes(q) || t.testCode.toLowerCase().includes(q)
    )
  }, [search, tests])

  const testParams = useMemo(
    () => (selTest ? parameters.filter((p) => p.testId === selTest.id) : []),
    [selTest, parameters]
  )

  if (!rule) return null

  const save = async (status: 'manual' | 'ignored'): Promise<void> => {
    const next: MappingRule = {
      ...rule,
      status,
      lisTestId: status === 'ignored' ? undefined : selTest?.id,
      lisTestCode: status === 'ignored' ? undefined : selTest?.testCode,
      lisTestName: status === 'ignored' ? undefined : selTest?.testName,
      lisParamId: status === 'ignored' ? undefined : selParam?.id,
      lisParamName: status === 'ignored' ? undefined : selParam?.name,
      unit: unit || rule.unit,
      confidence: undefined,
      updatedAt: new Date().toISOString()
    }
    await window.api.mappings.upsert(next)
    onClose()
  }

  return (
    <Modal
      open={!!rule}
      onClose={onClose}
      title={`Map "${rule.instrumentCode}"`}
      description={rule.instrumentName}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={() => save('ignored')}>
            <Ban className="h-4 w-4" /> Ignore Analyte
          </Button>
          <Button onClick={() => save('manual')} disabled={!selTest}>
            <Check className="h-4 w-4" /> Save Mapping
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/60 bg-secondary/30 p-3">
            <p className="text-xs uppercase text-muted-foreground">Instrument analyte</p>
            <p className="mt-1 font-mono font-semibold text-accent">{rule.instrumentCode}</p>
            <p className="text-xs text-muted-foreground">{rule.instrumentName}</p>
          </div>
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs uppercase text-muted-foreground">Mapped LIS target</p>
            <p className="mt-1 font-semibold text-primary">
              {selParam ? selParam.name : selTest ? selTest.testName : 'Not selected'}
            </p>
            {selTest && <p className="text-xs text-muted-foreground">{selTest.testCode}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Search LIS test catalog</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by test name or code..."
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-1">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setSelTest(t)
                setSelParam(null)
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                selTest?.id === t.id ? 'bg-primary/15 text-primary' : 'hover:bg-secondary/60'
              )}
            >
              <span>
                <span className="font-medium">{t.testName}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{t.testCode}</span>
              </span>
              {t.hasParameters && <Badge tone="accent">panel</Badge>}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No matching tests.</p>
          )}
        </div>

        {testParams.length > 0 && (
          <div className="space-y-1.5">
            <Label>Parameter (panel member)</Label>
            <div className="flex flex-wrap gap-1.5">
              {testParams.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelParam(selParam?.id === p.id ? null : p)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs transition-colors',
                    selParam?.id === p.id
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border hover:bg-secondary/60'
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Unit override (optional)</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. uIU/mL" />
        </div>
      </div>
    </Modal>
  )
}
