# Docker Deployment Guide

This guide covers running the Carpooling Backend application using Docker and Docker Compose.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Common Commands](#common-commands)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Docker**: v20.10 or higher
- **Docker Compose**: v2.0 or higher
- At least 2GB of free RAM
- Ports available: 3000 (API), 5432 (PostgreSQL), 6379 (Redis)

---

## Quick Start

### 1. Configure Environment

Copy the Docker-specific environment file:

```bash
cp .env.docker .env.docker.local
```

Edit `.env.docker.local` with your specific configuration (API keys, credentials, etc.).

Update `docker-compose.yml` to use your local file:

```yaml
env_file:
  - path: .env.docker.local
    required: false
```

### 2. Build and Start Services

```bash
# Build images and start all services
docker-compose up --build

# Or run in detached mode (background)
docker-compose up -d --build
```

### 3. Verify Services

Check that all services are healthy:

```bash
docker-compose ps
```

Expected output:
```
NAME                STATUS              PORTS
api                 Up (healthy)        0.0.0.0:3000->3000/tcp
mail-worker         Up                  
sms-worker          Up                  
postgres            Up (healthy)        0.0.0.0:5432->5432/tcp
redis               Up (healthy)        0.0.0.0:6379->6379/tcp
migrate             Exited (0)
```

### 4. Test the API

```bash
# Health check
curl http://localhost:3000/health

# API documentation
open http://localhost:3000/docs
```

---

## Architecture

### Services Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Docker Compose                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   postgres   │  │    redis     │  │   migrate    │ │
│  │  (DB Server) │  │  (Cache/Q)   │  │  (One-shot)  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │          │
│         └──────────────────┴──────────────────┘          │
│                            │                              │
│  ┌────────────────────────┴──────────────────────────┐  │
│  │                     api                            │  │
│  │  • REST API (port 3000)                           │  │
│  │  • WebSocket Server                               │  │
│  │  • Health checks                                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌──────────────┐                   ┌──────────────┐   │
│  │ mail-worker  │                   │  sms-worker  │   │
│  │ (Background) │                   │ (Background) │   │
│  └──────────────┘                   └──────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Container Details

#### 1. **postgres** (PostgreSQL 16)
- Database server for persistent data storage
- Exposed on port **5432**
- Data persisted in `postgres_data` volume
- Auto-restarts unless stopped

#### 2. **redis** (Redis 7)
- Cache and message queue (BullMQ)
- Exposed on port **6379**
- Data persisted in `redis_data` volume
- Configured with 256MB max memory

#### 3. **migrate** (One-shot service)
- Runs Prisma migrations once at startup
- Exits after completion
- Must succeed before app services start
- Does **not** restart automatically

#### 4. **api** (Main Application)
- REST API server
- WebSocket server
- Swagger documentation at `/docs`
- Health endpoint at `/health`
- Runs migrations via entrypoint (idempotent)

#### 5. **mail-worker** (Background Worker)
- Processes email queue
- Sends transactional emails
- Auto-restarts on failure

#### 6. **sms-worker** (Background Worker)
- Processes SMS queue
- Sends OTP and notifications via Twilio
- Auto-restarts on failure

---

## Configuration

### Environment Variables

Key environment variables for Docker deployment:

| Variable | Docker Value | Description |
|----------|--------------|-------------|
| `DATABASE_URL` | `postgresql://carpooling:carpooling@postgres:5432/carpooling` | PostgreSQL connection (uses service name) |
| `REDIS_URL` | `redis://redis:6379` | Redis connection (uses service name) |
| `REDIS_HOST` | `redis` | Redis hostname (Docker service) |
| `NODE_ENV` | `development` or `production` | Environment mode |
| `PORT` | `3000` | API server port |

### Service Configuration

You can customize service behavior via `docker-compose.yml`:

```yaml
# Change PostgreSQL credentials
environment:
  POSTGRES_USER: myuser
  POSTGRES_PASSWORD: mypassword
  POSTGRES_DB: mydb

# Change exposed ports
ports:
  - "8080:3000"  # Map container port 3000 to host port 8080

# Adjust resource limits
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
```

---

## Common Commands

### Start Services

```bash
# Start all services (foreground)
docker-compose up

# Start all services (background)
docker-compose up -d

# Start specific service
docker-compose up api

# Rebuild and start
docker-compose up --build
```

### Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v

# Stop specific service
docker-compose stop api
```

### View Logs

```bash
# View all logs
docker-compose logs

# Follow logs (live tail)
docker-compose logs -f

# View specific service logs
docker-compose logs api
docker-compose logs mail-worker

# Last 100 lines
docker-compose logs --tail=100 api
```

### Database Operations

```bash
# Run Prisma migrations
docker-compose exec api npx prisma migrate deploy

# Open Prisma Studio
docker-compose exec api npx prisma studio

# Connect to PostgreSQL
docker-compose exec postgres psql -U carpooling -d carpooling

# Backup database
docker-compose exec postgres pg_dump -U carpooling carpooling > backup.sql

# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U carpooling carpooling
```

### Redis Operations

```bash
# Connect to Redis CLI
docker-compose exec redis redis-cli

# Check queue jobs
docker-compose exec redis redis-cli KEYS "bull:*"

# Flush all data (⚠️ clears cache and queues)
docker-compose exec redis redis-cli FLUSHALL
```

### Shell Access

```bash
# Access API container shell
docker-compose exec api sh

# Access as root
docker-compose exec -u root api sh

# Run one-off command
docker-compose exec api npm run build
```

---

## Troubleshooting

### Service Won't Start

**Check service status:**
```bash
docker-compose ps
```

**View error logs:**
```bash
docker-compose logs api
```

**Restart service:**
```bash
docker-compose restart api
```

### Migration Failures

If migrations fail, check:

1. Database is accessible:
```bash
docker-compose exec postgres pg_isready -U carpooling
```

2. View migration logs:
```bash
docker-compose logs migrate
```

3. Manually run migrations:
```bash
docker-compose exec api npx prisma migrate deploy
```

4. Reset migrations (⚠️ destructive):
```bash
docker-compose exec api npx prisma migrate reset
```

### Port Already in Use

If you get "port already allocated" errors:

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change the port in docker-compose.yml
ports:
  - "3001:3000"
```

### Out of Memory

If containers crash with OOM errors:

1. Check Docker resources:
```bash
docker stats
```

2. Increase Docker memory limit (Docker Desktop > Settings > Resources)

3. Reduce Redis memory:
```yaml
redis:
  command: redis-server --maxmemory 128mb
```

### Database Connection Issues

```bash
# Test database connection
docker-compose exec api npx prisma db push

# Check database logs
docker-compose logs postgres

# Verify environment variables
docker-compose exec api env | grep DATABASE_URL
```

### Clear Everything and Restart

```bash
# Stop and remove everything
docker-compose down -v

# Remove images
docker-compose down --rmi all

# Rebuild from scratch
docker-compose build --no-cache
docker-compose up -d
```

---

## Production Considerations

### Security

1. **Use secrets management** instead of `.env` files
2. **Run as non-root** (already configured in Dockerfile)
3. **Enable TLS** for external connections
4. **Rotate credentials** regularly

### Performance

1. **Use single-process mode** (default in updated Dockerfile)
2. **Scale horizontally** with orchestrators (Kubernetes, Railway)
3. **Enable connection pooling** for PostgreSQL
4. **Monitor resource usage** with Prometheus/Grafana

### Scaling

To run multiple API instances:

```bash
docker-compose up -d --scale api=3
```

Or use a load balancer like nginx:

```yaml
nginx:
  image: nginx:alpine
  ports:
    - "80:80"
  depends_on:
    - api
```

---

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Prisma Docker Guide](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-docker)
- [Railway Deployment Guide](./railway-deployment.md)

