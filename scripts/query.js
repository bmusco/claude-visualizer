#!/usr/bin/env node
const { RedshiftDataClient, ExecuteStatementCommand, DescribeStatementCommand, GetStatementResultCommand } = require('@aws-sdk/client-redshift-data');

const sql = process.argv.slice(2).join(' ');
if (!sql) { console.error('Usage: node query.js "SELECT ..."'); process.exit(1); }

const upper = sql.trim().toUpperCase();
if (/^\s*(DROP|DELETE|TRUNCATE|ALTER|INSERT|UPDATE|CREATE|GRANT|REVOKE)\b/.test(upper)) {
  console.error('Only SELECT queries are allowed');
  process.exit(1);
}

const client = new RedshiftDataClient({ region: process.env.REDSHIFT_REGION || 'us-east-1' });
const CLUSTER = process.env.REDSHIFT_CLUSTER || 'cmt-cmt-alpha-analytics';
const DATABASE = process.env.REDSHIFT_DATABASE || 'cmt_alpha_vtrack';
const DB_USER = process.env.REDSHIFT_DB_USER || 'bmusco@cmtelematics.com';

(async () => {
  try {
    const exec = await client.send(new ExecuteStatementCommand({
      ClusterIdentifier: CLUSTER, Database: DATABASE, DbUser: DB_USER, Sql: sql,
    }));

    let status = 'SUBMITTED', attempts = 0;
    while (status !== 'FINISHED' && status !== 'FAILED' && status !== 'ABORTED' && attempts < 60) {
      await new Promise(r => setTimeout(r, attempts < 5 ? 500 : 2000));
      const desc = await client.send(new DescribeStatementCommand({ Id: exec.Id }));
      status = desc.Status;
      if (status === 'FAILED') { console.error('Query failed:', desc.Error); process.exit(1); }
      if (status === 'ABORTED') { console.error('Query aborted'); process.exit(1); }
      attempts++;
    }
    if (status !== 'FINISHED') { console.error('Query timeout'); process.exit(1); }

    const result = await client.send(new GetStatementResultCommand({ Id: exec.Id }));
    const fields = (result.ColumnMetadata || []).map(c => c.name);
    const rows = result.Records || [];

    if (fields.length === 0) { console.log('(no results)'); return; }

    // Print as TSV table
    console.log(fields.join('\t'));
    console.log(fields.map(() => '---').join('\t'));
    for (const row of rows.slice(0, 200)) {
      console.log(row.map(cell => cell.stringValue ?? cell.longValue ?? cell.doubleValue ?? cell.booleanValue ?? '').join('\t'));
    }
    if (rows.length > 200) console.log(`... (${rows.length - 200} more rows)`);
    console.log(`\n${rows.length} row(s)`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
