#!/bin/bash
# Run once with: bash ~/home-finance/setup.sh
set -e

echo "==> Creating /var/www/finance"
mkdir -p /var/www/finance

echo "==> Copying frontend build"
cp -r /home/austin/home-finance/frontend/dist/. /var/www/finance/

echo "==> Adding nginx finance blocks"
# Insert before the closing } of the ssl server block
python3 - << 'PYEOF'
import re

with open('/etc/nginx/sites-enabled/default', 'r') as f:
    config = f.read()

FINANCE_BLOCKS = """
    # Finance API
    location /finance/api/ {
        proxy_pass http://localhost:8100/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Finance static assets
    location /finance/assets/ {
        root /var/www;
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Finance frontend
    location /finance/ {
        root /var/www;
        try_files $uri $uri/ /finance/index.html;
        add_header Cache-Control "no-cache";
    }
"""

if '/finance/' in config:
    print("Finance blocks already present in nginx config, skipping")
else:
    # Insert before the catch-all location /
    config = config.replace('\n    location / {', FINANCE_BLOCKS + '\n    location / {')
    with open('/etc/nginx/sites-enabled/default', 'w') as f:
        f.write(config)
    print("Finance blocks added to nginx config")
PYEOF

echo "==> Testing nginx config"
nginx -t

echo "==> Reloading nginx"
systemctl reload nginx

echo "==> Creating systemd service"
cat > /etc/systemd/system/home-finance.service << 'EOF'
[Unit]
Description=Home Finance
After=network.target

[Service]
Type=simple
User=austin
WorkingDirectory=/home/austin/home-finance/backend
ExecStart=/usr/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "==> Enabling and starting home-finance service"
systemctl daemon-reload
systemctl enable home-finance
systemctl restart home-finance

echo ""
echo "==> Setup complete!"
echo "    https://10.0.0.24/finance/"
echo ""
echo "Service status:"
systemctl status home-finance --no-pager
