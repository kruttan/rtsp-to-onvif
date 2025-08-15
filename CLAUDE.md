# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RTSP to ONVIF Proxy - A Docker-based solution that creates virtual ONVIF devices from RTSP streams, allowing integration with UniFi Protect 5+. The proxy creates virtual network interfaces with unique MAC addresses and handles DHCP registration automatically.

## Architecture

### Core Components

1. **main.js** - Entry point that orchestrates the proxy setup:
   - Reads and validates configuration
   - Creates ONVIF servers for each camera
   - Sets up TCP proxies for RTSP and snapshot traffic

2. **src/onvif-server.js** - ONVIF server implementation:
   - Handles ONVIF SOAP protocol
   - Manages device discovery via WS-Discovery
   - Serves WSDL definitions for device and media services

3. **src/config-tools.js** - Configuration management:
   - Auto-generates UUIDs and MAC addresses if missing
   - Creates virtual network interfaces (macvlan)
   - Handles DHCP registration for virtual interfaces

4. **src/net-tools.js** - Network utilities:
   - MAC to IP resolution
   - UUID v4 generation
   - LAA MAC address generation (prefix: 1A:11:B0)

### Key Concepts

- **Virtual Network Interfaces**: Uses macvlan to create virtual NICs with unique MACs
- **TCP Proxy**: Routes RTSP/HTTP traffic from virtual IPs to actual camera IPs
- **ONVIF Profile S**: Implements subset for video streaming (no PTZ/audio/analytics)
- **Auto-configuration**: Generates missing MACs/UUIDs and registers with DHCP

## Common Commands

### Build and Run
```bash
# Build Docker image locally
./build-docker.sh

# Run with Docker Compose (production)
docker compose up -d

# Run with Docker Compose (debug mode)
docker compose up

# Stop container
docker compose down
```

### Development
```bash
# Install dependencies
npm install

# Run locally (requires root for network operations)
sudo node main.js /path/to/config.yaml

# Enable debug output
DEBUG=1 node main.js /path/to/config.yaml
```

### Debugging Network Issues
```bash
# List virtual interfaces
ip link show | grep rtsp2onvif

# Remove virtual interface manually
sudo ip link del dev rtsp2onvif_0

# Check IP assignments
ip addr show

# Test RTSP stream
vlc rtsp://camera_ip:554/path
```

## Configuration Structure

The `config.yaml` defines cameras with:
- **name**: Display name in UniFi Protect
- **dev**: Host network interface (e.g., eth0, enp2s0)
- **target**: Real camera connection details
- **highQuality**: Stream parameters (resolution, fps, bitrate)
- **ports**: Virtual server ports (typically 8081, 8554, 8080)
- **mac/uuid**: Auto-generated if not specified

## Testing Approach

No formal test suite exists. Validation involves:
1. Checking ONVIF discovery responses
2. Verifying RTSP proxy connections
3. Testing adoption in UniFi Protect
4. Monitoring logs with DEBUG=1

## Important Implementation Details

- Container runs with `NET_ADMIN` capability for network interface management
- Uses `host` network mode to expose virtual IPs directly
- DHCP client (`dhclient`) obtains IPs for virtual interfaces
- Config file gets auto-updated with generated MACs/UUIDs
- Supports H.264 streams only (H.265 compatibility varies)