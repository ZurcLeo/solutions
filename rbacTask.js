const { backfillRbacToSupabase, reconcileRbac } = require('./utils/rbacMigrationUtils');
const { logger } = require('./logger');

async function runTask() {
  const task = process.argv[2];
  
  if (task === 'backfill') {
    logger.info('Iniciando tarefa de BACKFILL...');
    const result = await backfillRbacToSupabase();
    console.log(JSON.stringify(result, null, 2));
  } else if (task === 'reconcile') {
    logger.info('Iniciando tarefa de RECONCILIAÇÃO...');
    const result = await reconcileRbac();
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Uso: node rbacTask.js [backfill|reconcile]');
  }
}

runTask().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
