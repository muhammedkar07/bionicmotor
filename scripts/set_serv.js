const { db } = require('../db');
db.prepare("UPDATE dealer_users SET role='servis' WHERE id=1").run();
console.log(db.prepare('SELECT id,role FROM dealer_users WHERE id=1').get());
