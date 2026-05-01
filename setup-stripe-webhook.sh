#!/bin/bash

# Stripe Webhook Setup Script for Local Development
# This script helps set up Stripe CLI for webhook forwarding

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║        Stripe Webhook Setup for Local Development         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if Stripe CLI is installed
print_step "Checking if Stripe CLI is installed..."
if command -v stripe &> /dev/null; then
    STRIPE_VERSION=$(stripe --version)
    print_success "Stripe CLI is installed: $STRIPE_VERSION"
else
    print_error "Stripe CLI is not installed"
    echo ""
    print_info "Install Stripe CLI:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew install stripe/stripe-cli/stripe"
    echo ""
    echo "  Linux:"
    echo "    wget https://github.com/stripe/stripe-cli/releases/latest/download/stripe_linux_x86_64.tar.gz"
    echo "    tar -xvf stripe_linux_x86_64.tar.gz"
    echo "    sudo mv stripe /usr/local/bin/"
    echo ""
    echo "  Windows:"
    echo "    Download from: https://github.com/stripe/stripe-cli/releases/latest"
    echo ""
    echo "  Or visit: https://stripe.com/docs/stripe-cli"
    echo ""
    exit 1
fi

# Check if logged in
print_step "Checking Stripe CLI authentication..."
if stripe config --list &> /dev/null; then
    print_success "Stripe CLI is authenticated"
else
    print_warning "Stripe CLI is not authenticated"
    print_info "Running 'stripe login'..."
    echo ""
    stripe login
    echo ""
    print_success "Authentication complete"
fi

# Check if server is running
print_step "Checking if server is running..."
if curl -s -f "http://localhost:3000/api/v1/auth/signup" > /dev/null 2>&1 || curl -s "http://localhost:3000/api/v1/auth/signup" | grep -q "success\|error"; then
    print_success "Server is running at http://localhost:3000"
else
    print_error "Server is not running at http://localhost:3000"
    print_info "Please start the server first:"
    echo "    npm run dev"
    echo ""
    exit 1
fi

# Display webhook endpoint
WEBHOOK_ENDPOINT="http://localhost:3000/api/v1/payments/webhook"
echo ""
print_info "Webhook endpoint: $WEBHOOK_ENDPOINT"
echo ""

# Start webhook forwarding
print_step "Starting Stripe webhook forwarding..."
print_warning "Keep this terminal open while testing!"
print_info "Press Ctrl+C to stop forwarding"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
print_info "IMPORTANT: Copy the webhook signing secret below and update your .env file:"
echo ""
echo "  STRIPE_WEBHOOK_SECRET=whsec_xxxxx"
echo ""
echo "Then restart your server: npm run dev"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Forward webhooks
stripe listen --forward-to "$WEBHOOK_ENDPOINT"
