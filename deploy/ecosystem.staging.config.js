// PM2 yapılandırması — TEST (STAGING) ORTAMI: test.bionicmotorsiklet.com
// Kullanım (sunucuda):  cd /var/www/bionic-test && pm2 start deploy/ecosystem.staging.config.js
//
// Bu süreç canlıdan TAMAMEN ayrıdır: ayrı dizin, ayrı port (3100), ayrı veritabanı.
// Değerler proje kökündeki .env dosyasından okunur (node --env-file=.env).

module.exports = {
  apps: [
    {
      name: 'bionic-test',
      cwd: '/var/www/bionic-test',
      script: 'server.js',
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      out_file: '/var/log/bionic-test/out.log',
      error_file: '/var/log/bionic-test/err.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3100
      }
    }
  ]
};
