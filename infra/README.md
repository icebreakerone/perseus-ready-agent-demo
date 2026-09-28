# Infrastructure

OpenTofu for running the demo on AWS (`eu-west-2`) at
https://perseusready.sandbox.demo.ib1.org.

```
Route 53 (demo.ib1.org) ─► ALB :443 (ACM, TLS 1.2+) ─► ECS Fargate task (ARM64, 1 task)
                           :80 → 301 to HTTPS             web: Next.js :3000 ─► EFS /app/.data
```

- **Network**: a dedicated VPC with two public subnets. The task has a public
  IP for outbound calls to the Perseus sandbox and NESO (no NAT gateway), and
  its security group admits only the load balancer.
- **Data**: the app's `.data` directory (session files and the permission
  log) is an encrypted EFS file system, reached only by the task role through
  an access point over TLS, and backed up daily. The session files have no
  locking, so the service never runs two tasks at once: deployments stop the
  old task before starting the new one, with a short outage.
- **Secrets**: one Secrets Manager secret (`perseusready/app`) holds the
  Directory-issued client and signing certificates, their keys and the
  session secret. OpenTofu creates only the empty secret, and
  `scripts/put-secrets.sh` sets the value from the files
  `scripts/setup-certs.sh` writes to `certs/`, so keys never enter the state.
  The container's entrypoint (`docker/web-entrypoint.sh`) writes the PEMs to
  `0600` files and removes them from the app's environment.
- **Images**: ECR, immutable tags (the git commit), scanned on push.

## First deployment

```sh
export AWS_PROFILE=kp-ib1

# 1. Once only: the S3 bucket for the state. Its own state stays local, in
#    infra/bootstrap/terraform.tfstate (gitignored): keep it. The bucket
#    perseusready-tofu-state-232615051732 already exists.
tofu -chdir=infra/bootstrap init && tofu -chdir=infra/bootstrap apply

# 2. Build, push and deploy. This also creates the ECR repository and the
#    secret, and fills the secret from certs/ if it is empty.
infra/scripts/deploy.sh
```

Later deployments just run `infra/scripts/deploy.sh`. After renewing
certificates in `certs/`, run `infra/scripts/put-secrets.sh`, then force a new
deployment so the task picks them up:

```sh
aws ecs update-service --cluster perseusready --service perseusready --force-new-deployment
```

## After the first deployment

- In the Directory, set the application's home page (and support) URL to
  `https://perseusready.sandbox.demo.ib1.org`.
- The EDP redirect URI becomes
  `https://perseusready.sandbox.demo.ib1.org/api/auth/callback`.

## Operating

- Logs: CloudWatch `/ecs/perseusready/web`.
- Shell into the task (ECS Exec is on by default):
  `aws ecs execute-command --cluster perseusready --task <id> --container web --interactive --command sh`
- Configuration: the non-secret app settings are the `app_config` variable in
  `variables.tf`, and mirror `.env.example`.
- Tear down: `tofu -chdir=infra destroy -var image_tag=unused`. EFS data is
  deleted with it, but its AWS Backup recovery points are not. The secret is
  kept for 7 days, which blocks recreating it under the same name: delete it
  with `aws secretsmanager delete-secret --secret-id perseusready/app
  --force-delete-without-recovery` first if you intend to redeploy.

Estimated cost: around $40–50 a month, mostly the load balancer, the Fargate
task and public IPv4 addresses.
