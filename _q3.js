const mysql=require('mysql2/promise');
(async()=>{
  const c=await mysql.createConnection({host:'localhost',port:3306,user:'root',password:'root123',database:'tradiaura_dev',timezone:'Z'});
  const [ev]=await c.query("SELECT * FROM automation_position_events WHERE position_id IN (SELECT id FROM automation_positions WHERE symbol='PUMPFUNUSDT') ORDER BY id ASC");
  const [ex]=await c.query("SELECT * FROM automation_executions WHERE id IN (SELECT execution_id FROM automation_positions WHERE symbol='PUMPFUNUSDT') OR symbol='PUMPFUNUSDT' ORDER BY id DESC LIMIT 10");
  await c.end();
})().catch(e=>{console.error(e);process.exit(1);});
