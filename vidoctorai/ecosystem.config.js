module.exports = {
  apps: [{
    name: "vidoctorai",
    script: "/var/www/vidoctorai/venv/bin/python3",
    args: "bot.py",
    cwd: "/var/www/vidoctorai",
    interpreter: "none",
    env: {
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8"
    },
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    error_file: "/var/www/vidoctorai/logs/err.log",
    out_file: "/var/www/vidoctorai/logs/out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
}
