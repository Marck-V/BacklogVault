# Deploying BacklogVault

The site runs on one small Linux server as two Docker containers: **Caddy** (the website, HTTPS) and the **API**
(Node, with the SQLite database on a Docker volume). GitHub Actions does the rest:

```
git push to main
  -> CI runs every check (tests, lint, typecheck, Docker smoke test)
  -> "publish" builds the two images and pushes them to ghcr.io, tagged with the commit
  -> "deploy" copies these files to the server over SSH and runs deploy.sh <commit>
       deploy.sh pulls the images, starts them, waits until both are healthy,
       and puts the previous version back if they are not
  -> CI checks https://<your site>/api/health from outside
```

The server never builds anything and never sees the source code. It holds only `docker-compose.prod.yml`, `deploy.sh`,
`backup.sh` and your `.env`.

The deploy job is **switched off until you set the `DEPLOY_HOST` variable** (step 5), so CI stays green before the
server exists.

## One-time setup

### 1. The server (Google Cloud, free tier)
Check Google's current free-tier page before you start; these details are from memory and they change.
- Create a Google Cloud account and **set a budget alert** (Billing > Budgets & alerts, for example $1), so a mistake
  can never surprise you.
- Create a VM: machine type **e2-micro**, a free-tier region (us-west1, us-central1 or us-east1), **Debian 12**, a
  **30 GB standard persistent disk**. Under Firewall tick **Allow HTTP traffic** and **Allow HTTPS traffic**. Under
  Access scopes allow **Storage: Read Write** if you want the nightly backup copied to Cloud Storage (step 6).
- Give it a **static external IP** (VPC network > IP addresses > Reserve), so its address never changes. Check the
  pricing page for external IP charges.

### 2. The name (DuckDNS, free)
Sign in at https://www.duckdns.org, create a subdomain (for example `backlogvault`) and set its IP to the static IP.
Your site will be `https://backlogvault.duckdns.org`.

### 3. Docker and basics on the server
SSH in (the **SSH** button in the Google Cloud console is easiest the first time) and run, one block at a time:

```bash
# Docker from Docker's own repository (https://docs.docker.com/engine/install/debian/)
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"     # then log out and back in

# 1 GB of swap: the e2-micro has about 1 GB of memory, and swap absorbs a spike instead of killing a container
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Security updates install themselves
sudo apt-get install -y unattended-upgrades

# The folder the deploy uses, and the settings file
mkdir -p ~/backlogvault && nano ~/backlogvault/.env    # fill it in from deploy/.env.example
chmod 600 ~/backlogvault/.env
```

### 4. A key for GitHub to log in with
On **your PC**, make a key used only for deploys (no passphrase, since CI cannot type one):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/backlogvault_deploy -C "github-deploy" -N ""
```

Add the **public** half (`~/.ssh/backlogvault_deploy.pub`) to the server: on the server, append it to
`~/.ssh/authorized_keys`. Then record the server's own key, so CI refuses any machine pretending to be your server:

```bash
ssh -i ~/.ssh/backlogvault_deploy <your-user>@<static-ip> echo ok    # answer "yes" once; this checks the key works
ssh-keyscan -t ed25519 <static-ip>                                    # copy the line it prints for the next step
```

### 5. GitHub settings
Repository > **Settings > Secrets and variables > Actions**.

| Kind | Name | Value |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | the whole **private** key file `~/.ssh/backlogvault_deploy` |
| Secret | `DEPLOY_KNOWN_HOSTS` | the line `ssh-keyscan` printed |
| Variable | `DEPLOY_USER` | your user name on the server |
| Variable | `SITE_ADDRESS` | `backlogvault.duckdns.org` (no https://) |
| Variable | `DATA_COUNTRY` | `United States` (shown on the privacy page) |
| Variable | `CONTACT_EMAIL` | the address shown on the privacy page |
| Variable | `DEPLOY_HOST` | the static IP. **Set this last**: it switches the deploy on |

Then push to `main` (or re-run the latest CI run). The first deploy also gets the HTTPS certificate, which takes a few
seconds. Open `https://<SITE_ADDRESS>`.

Also register `SITE_ADDRESS` as the domain of your **Steam Web API key** (https://steamcommunity.com/dev/apikey).

### 6. Nightly backups
Without this, losing the server's disk loses every library.
- Optional but strongly recommended: create a Cloud Storage bucket in the same region (for example
  `gs://backlogvault-backups`) and set `BACKUP_BUCKET=gs://backlogvault-backups` in the server's `.env`. Check the
  free-tier storage allowance.
- On the server, run `crontab -e` and add:
  ```
  15 3 * * * /home/<your-user>/backlogvault/backup.sh >> /home/<your-user>/backlogvault/backup.log 2>&1
  ```
- Run `~/backlogvault/backup.sh` once by hand and check the file appears in `~/backlogvault/backups` (and the bucket).
- Once, practise a restore: copy a backup to your PC and open it, or follow "Restoring the database" below on a
  test machine.

### 7. Watch it
Add the site to a free uptime monitor (for example UptimeRobot) so you get an email if it goes down.

## Everyday use

| You want to | Do this |
|---|---|
| Update the site | Push to `main`. About two minutes later it is live, or CI is red and the old version is still running |
| See what is running | On the server: `cat ~/backlogvault/.deployed` |
| Go back one version | On the server: log in to the registry (below), then `cd ~/backlogvault && ./deploy.sh rollback` |
| Deploy an older commit | Re-run that commit's CI run in GitHub (Actions > the run > Re-run jobs) |
| Read the logs | `cd ~/backlogvault && docker compose -f docker-compose.prod.yml --env-file .env logs --tail 100` (prefix with `IMAGE_REPO=... IMAGE_TAG=...` from `.deployed`) |

The images are private, so pulling by hand needs a login: make a GitHub personal access token with only
`read:packages`, then `docker login ghcr.io -u <github-user>` on the server, and `docker logout ghcr.io` afterwards.
CI logs in with a token that expires when the job ends, so nothing long-lived is stored on the server.

## Restoring the database
Rehearsed on a throwaway volume (2026-10-14). On the server, in `~/backlogvault`, with `<file>` the backup to restore:

```bash
read -r IMAGE_REPO IMAGE_TAG < .deployed && export IMAGE_REPO IMAGE_TAG
C="docker compose -f docker-compose.prod.yml --env-file .env"
$C stop api
# The API image itself does the copy, so nothing else is downloaded. The -wal and -shm files belong to the old
# database and must go, and the file must belong to the API's user.
docker run --rm --user root -v backlogvault_backlog-data:/data -v "$PWD/backups:/backups:ro" --entrypoint sh   "$IMAGE_REPO/backlogvault-api:$IMAGE_TAG"   -c 'cp /backups/<file> /data/backlog.db && rm -f /data/backlog.db-wal /data/backlog.db-shm && chown node:node /data/backlog.db'
$C start api
```

Then open the site and check your lists.
