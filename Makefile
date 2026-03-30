.PHONY: build run deploy deploy-api deploy-frontend deploy-dry logs down clean

# Load .env if present
-include .env
export

build:
	docker build --platform linux/amd64 -t claudio-api:latest .

run:
	docker-compose up -d
	@echo "Claud-io running at http://localhost:3333"

# Deploy both frontend + API
deploy: deploy-frontend deploy-api

# API → ECR + ECS
deploy-api:
	./scripts/deploy.sh

deploy-api-dry:
	DRY_RUN=1 ./scripts/deploy.sh

# Frontend → S3 + CloudFront
deploy-frontend:
	./scripts/deploy-frontend.sh

logs:
	docker-compose logs -f

down:
	docker-compose down

clean:
	docker-compose down -v
	docker rmi claudio-api:latest 2>/dev/null || true
