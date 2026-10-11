# Auto-deploy to the VPS

Every merge into `main` deploys automatically. GitHub Actions
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) connects to the
VPS over SSH and runs [scripts/deploy.sh](scripts/deploy.sh), which does what a
manual deploy does, in this order:

1. Pull the latest `main` into `~/tradenaya`.
2. Run `npm ci`, only if `package.json` or `package-lock.json` changed.
3. Build into `.next-build`. The live app keeps running from `.next` during the build.
4. Swap the new build in and run `pm2 restart`.
5. Check that `http://127.0.0.1:3000/signin` answers with HTTP 200.

If anything fails, the live app is either untouched (install or build failed) or
rolled back to the previous version and restarted (health check failed). The
**Actions** tab on GitHub shows each deploy's full output, including the reason
for a failure.

Restarting the app also restarts the bot scheduler and position monitor. They
recover their running bots and open positions on start-up, the same as after a
manual restart.

## One-time setup

### 1. Create a deploy key (on your PC, in PowerShell)

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\tradenaya_deploy -N '""' -C "github-actions-deploy"
```

This creates `tradenaya_deploy` (the private key, which goes to GitHub) and
`tradenaya_deploy.pub` (the public key, which goes to the server).

### 2. Allow the key on the server

```powershell
type $HOME\.ssh\tradenaya_deploy.pub | ssh tradenayaadmin@185.67.20.40 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Check that it logs in without asking for a password:

```powershell
ssh -i $HOME\.ssh\tradenaya_deploy tradenayaadmin@185.67.20.40 "pm2 list"
```

Note the app's **name** in the `pm2 list` output.

### 3. Get the server's host key

```powershell
ssh-keyscan 185.67.20.40
```

Copy all the lines it prints.

### 4. Add secrets in GitHub

Go to **GitHub → tradenaya/tradenaya → Settings → Secrets and variables → Actions**.

**Secrets** tab, "New repository secret":

| Name                 | Value                                                        |
|----------------------|--------------------------------------------------------------|
| `DEPLOY_HOST`        | `185.67.20.40`                                               |
| `DEPLOY_USER`        | `tradenayaadmin`                                             |
| `DEPLOY_SSH_KEY`     | the whole content of `$HOME\.ssh\tradenaya_deploy` (the private key, including the `BEGIN`/`END` lines) |
| `DEPLOY_KNOWN_HOSTS` | the output of step 3                                         |

**Variables** tab, needed only if they differ from the defaults:

| Name       | Default     | When to set it                                    |
|------------|-------------|---------------------------------------------------|
| `PM2_APP`  | `tradenaya` | if `pm2 list` shows a different name              |
| `APP_PORT` | `3000`      | if the app listens on another port                |

### 5. Check the server's copy is clean

On the server:

```bash
cd ~/tradenaya && git status
```

If it lists modified files, commit or discard them (`git checkout -- <file>`).
The deploy refuses to run over local edits on the server.

## Day to day

* Merge a PR into `main`. The deploy starts by itself; watch it under **Actions → Deploy to VPS**.
* To redeploy without a new merge: **Actions → Deploy to VPS → Run workflow**.
* To deploy by hand on the server: `bash ~/tradenaya/scripts/deploy.sh`. Add `FORCE=1` in front to rebuild even when nothing changed.
* If a deploy fails its health check, the failed build is kept in `~/tradenaya/.next-failed` so you can investigate.
