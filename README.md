![image](https://github.com/OvernodeProjets/Fixed-Palladium/assets/73477238/e864f37f-e570-4d60-bb80-b0b7b4fc1618)
![image](https://github.com/OvernodeProjets/Fixed-Palladium/assets/73477238/2fcdb76a-459e-4e7c-8c16-e53ff20a4f27)

<hr>

# Fixed-Palladium

All features:
- Resource Management (Use it to create servers, gift them, etc)
- Coins (AFK Page earning)
- Servers (create, view, edit servers)
- User System (auth, regen password, etc)
- OAuth2 (Google, Discord, etc)
- Store (buy resources with coins)
- Dashboard (view resources & servers)
- Admin (set/add/remove coins)

<br>

| :exclamation:  This is an extremely early version of Fixed-Palladium and doesn't have all of features we want to add yet                                   |
|------------------------------------------------------------------------------------------------------------------------------------------------------|

<br>

| :warning:  Fixed-Palladium currently doesn't encrypt user passwords. This will be fixed in 1.0.1, but for now, just don't leak your database.sqlite.       |
|------------------------------------------------------------------------------------------------------------------------------------------------------|

<hr>

# Install Guide

Warning: You need Pterodactyl already set up on a domain for Fixed-Palladium to work
1. Upload the file above onto a Pterodactyl NodeJS server [Download the egg from Parkervcp's GitHub Repository](https://github.com/parkervcp/eggs/blob/master/generic/nodejs/egg-node-js-generic.json)
2. Unarchive the file and set the server to use NodeJS 16
3. Configure `.env`, `/resources/configuration/locations.ejs` & `/storage/eggs.json` & `/storage/plans.json`
4. Run `npm i`
5. Start the server with `node index.js`
6. Login to your DNS manager, point the domain you want your dashboard to be hosted on to your VPS IP address. (Example: dashboard.domain.com 192.168.0.1)
7. Run `apt install nginx && apt install certbot` on the vps
8. Run `ufw allow 80` and `ufw allow 443` on the vps
9. Run `certbot certonly -d <Your domain>` then do 1 and put your email
10. Run `nano /etc/nginx/sites-enabled/fixed-palladium.conf`
11. Paste the configuration at the bottom of this and replace with the IP of the pterodactyl server including the port and with the domain you want your dashboard to be hosted on.
12. Run `systemctl restart nginx` and try open your domain.

# Nginx Proxy Config
```Nginx
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name <domain>;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols SSLv3 TLSv1 TLSv1.1 TLSv1.2;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    if ($scheme != "https") {
        return 301 https://$host$request_uri;
    }

    location /afkwspath {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://localhost:<port>/afkwspath;
    }

    location / {
        proxy_pass http://localhost:<port>/;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

# Credit
- [Palladium](https://github.com/PinePlatforms/Palladium)
- [Palladium, fork by Ghostload74](https://github.com/Ghostload74/Palladium)

