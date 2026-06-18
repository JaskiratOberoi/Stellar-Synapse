import mssql from 'mssql'

const settings = {
  server: '122.161.198.159',
  port: 1433,
  database: 'Noble',
  user: 'nobleone',
  password: process.env.NOBLE_PASSWORD ?? '',
  options: { encrypt: false, trustServerCertificate: true }
}

try {
  const pool = await mssql.connect(settings)
  const tests = await pool
    .request()
    .query(
      `SELECT TOP 10 id, TestCode, Testname, Has_Parameters FROM tbl_med_test_master
       WHERE Testname LIKE '%HbA1c%' OR TestCode LIKE '%HBA1%' OR Testname LIKE '%Glycated%'`
    )
  console.log('TESTS', JSON.stringify(tests.recordset, null, 2))

  if (tests.recordset[0]) {
    const testId = tests.recordset[0].id
    const params = await pool
      .request()
      .input('testId', mssql.Int, testId)
      .query(
        `SELECT id, TestCode AS testId, Code, Name, Method FROM tbl_med_parameter_master
         WHERE TestCode = @testId AND IsActive = 1`
      )
    console.log('PARAMS', JSON.stringify(params.recordset, null, 2))
  }

  const sample = await pool
    .request()
    .input('vailid', mssql.VarChar, '8662517')
    .query(
      `SELECT TOP 1 vailid, patient_id, testcodes, testnames FROM tbl_med_mcc_patient_samples WHERE vailid = @vailid`
    )
  console.log('SAMPLE', JSON.stringify(sample.recordset, null, 2))

  await pool.close()
} catch (err) {
  console.error('ERR', err.message)
  process.exit(1)
}
