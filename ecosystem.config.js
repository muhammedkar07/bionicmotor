// PM2 yapılandırması — bionicmotorsiklet.com/bionic
// Kullanım:  pm2 start ecosystem.config.js   (sonra: pm2 save && pm2 startup)
//
// Tüm ortam değişkenleri proje kökündeki .env dosyasından okunur (node --env-file=.env).
// Bu yüzden gerçek değerleri .env'e yazın; burada şifre tutmayın.

module.exports = {
  apps: [
    {
      name: 'bionic',
      cwd: '/var/www/bionic',
      script: 'server.js',
      // Node 20.6+ yerleşik .env desteği:
      node_args: '--env-file=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      out_file: '/var/log/bionic/out.log',
      error_file: '/var/log/bionic/err.log',
      time: true,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
