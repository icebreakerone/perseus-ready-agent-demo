#!/usr/bin/env bash
# Build the image for linux/arm64, push it to ECR tagged with the git
# commit, and apply the stack. The first run also creates the repository
# and the secret, and fills the secret from certs/.
#
#   AWS_PROFILE=kp-ib1 infra/scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export AWS_PROFILE="${AWS_PROFILE:-kp-ib1}" AWS_REGION="${AWS_REGION:-eu-west-2}"

# ECR tags are immutable, so uncommitted changes get a unique tag.
TAG="$(git rev-parse --short=12 HEAD)"
if [ -n "$(git status --porcelain)" ]; then TAG="$TAG-dirty-$(date +%Y%m%d%H%M%S)"; fi
echo "Deploying image tag $TAG"

tofu -chdir=infra init -backend-config=backend.hcl -input=false >/dev/null

# The repository and the secret must exist before the image and values can go in.
tofu -chdir=infra apply -var "image_tag=$TAG" \
  -target='aws_ecr_repository.web' -target='aws_ecr_lifecycle_policy.web' -target='aws_secretsmanager_secret.app'

SECRET_ID="$(tofu -chdir=infra output -raw secret_arn)"
if ! aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query VersionId --output text >/dev/null 2>&1; then
  infra/scripts/put-secrets.sh "$SECRET_ID"
fi

REGISTRY="$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/arm64 --provenance=false -t "$REGISTRY/perseusready/web:$TAG" --push .

tofu -chdir=infra apply -var "image_tag=$TAG"
aws ecs wait services-stable --cluster "$(tofu -chdir=infra output -raw cluster)" --services "$(tofu -chdir=infra output -raw service)"
echo "Live at $(tofu -chdir=infra output -raw url)"
