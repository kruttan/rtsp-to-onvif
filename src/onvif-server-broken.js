const soap = require('soap');
const http = require('http');
const dgram = require('dgram');
const xml2js = require('xml2js');
const { v1: uuidv1 } = require('uuid');
const url = require('url');
const fs = require('fs');
const path = require('path');

const { getIp4FromMac } = require('./net-tools')

Date.prototype.stdTimezoneOffset = function () {
    let jan = new Date(this.getFullYear(), 0, 1);
    let jul = new Date(this.getFullYear(), 6, 1);
    return Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
}

Date.prototype.isDstObserved = function () {
    return this.getTimezoneOffset() < this.stdTimezoneOffset();
}

module.exports = class OnvifServer {
    constructor(logger, config) {
        this.config = config;
        this.logger = logger;

        this.config.hostname = getIp4FromMac(logger, this.config.mac);
        if (!this.config.hostname)
            return -1;

        this.videoSource = {
            attributes: {
                token: 'video_src_token'
            },
            Framerate: this.config.highQuality.framerate,
            Resolution: { Width: this.config.highQuality.width, Height: this.config.highQuality.height }
        };

        this.profiles = [
            {
                Name: 'MainStream',
                attributes: {
                    token: 'main_stream'
                },
                VideoSourceConfiguration: {
                    Name: 'VideoSource',
                    UseCount: 2,
                    attributes: {
                        token: 'video_src_config_token'
                    },
                    SourceToken: 'video_src_token',
                    Bounds: { attributes: { x: 0, y: 0, width: this.config.highQuality.width, height: this.config.highQuality.height } }
                },
                VideoEncoderConfiguration: {
                    attributes: {
                        token: 'encoder_hq_config_token'
                    },
                    Name: 'CardinalHqCameraConfiguration',
                    UseCount: 1,
                    Encoding: 'H264',
                    Resolution: {
                        Width: this.config.highQuality.width,
                        Height: this.config.highQuality.height
                    },
                    Quality: this.config.highQuality.quality,
                    RateControl: {
                        FrameRateLimit: this.config.highQuality.framerate,
                        EncodingInterval: 1,
                        BitrateLimit: this.config.highQuality.bitrate
                    },
                    H264: {
                        GovLength: this.config.highQuality.framerate,
                        H264Profile: 'Main'
                    },
                    SessionTimeout: 'PT1000S'
                }
            }
        ];

        if (this.config.lowQuality) {
            this.profiles.push(
                {
                    Name: 'SubStream',
                    attributes: {
                        token: 'sub_stream'
                    },
                    VideoSourceConfiguration: {
                        Name: 'VideoSource',
                        UseCount: 2,
                        attributes: {
                            token: 'video_src_config_token'
                        },
                        SourceToken: 'video_src_token',
                        Bounds: { attributes: { x: 0, y: 0, width: this.config.highQuality.width, height: this.config.highQuality.height } }
                    },
                    VideoEncoderConfiguration: {
                        attributes: {
                            token: 'encoder_lq_config_token'
                        },
                        Name: 'CardinalLqCameraConfiguration',
                        UseCount: 1,
                        Encoding: 'H264',
                        Resolution: {
                            Width: this.config.lowQuality.width,
                            Height: this.config.lowQuality.height
                        },
                        Quality: this.config.lowQuality.quality,
                        RateControl: {
                            FrameRateLimit: this.config.lowQuality.framerate,
                            EncodingInterval: 1,
                            BitrateLimit: this.config.lowQuality.bitrate
                        },
                        H264: {
                            GovLength: this.config.lowQuality.framerate,
                            H264Profile: 'Main'
                        },
                        SessionTimeout: 'PT1000S'
                    }
                }
            );
        }

        this.onvif = {
            DeviceService: {
                Device: {
                    GetSystemDateAndTime: (args) => {
                        let now = new Date();
                        
                        // Force current time
                        if (now.getFullYear() < 2020) {
                            now = new Date();
                        }

                        let offset = now.getTimezoneOffset();
                        let abs_offset = Math.abs(offset);
                        let hrs_offset = Math.floor(abs_offset / 60);
                        let mins_offset = (abs_offset % 60);
                        let tz = 'UTC' + (offset > 0 ? '-' : '+') + hrs_offset + (mins_offset === 0 ? '' : ':' + mins_offset);

                        return {
                            SystemDateAndTime: {
                                DateTimeType: 'NTP',
                                DaylightSavings: now.isDstObserved(),
                                TimeZone: {
                                    TZ: tz
                                },
                                UTCDateTime: {
                                    Time: { Hour: now.getUTCHours(), Minute: now.getUTCMinutes(), Second: now.getUTCSeconds() },
                                    Date: { Year: now.getUTCFullYear(), Month: now.getUTCMonth() + 1, Day: now.getUTCDate() }
                                },
                                LocalDateTime: {
                                    Time: { Hour: now.getHours(), Minute: now.getMinutes(), Second: now.getSeconds() },
                                    Date: { Year: now.getFullYear(), Month: now.getMonth() + 1, Day: now.getDate() }
                                },
                                Extension: {}
                            }
                        };
                    },

                    GetCapabilities: (args) => {
                        let response = {
                            Capabilities: {}
                        };

                        if (args.Category === undefined || args.Category == 'All' || args.Category == 'Device') {
                            response.Capabilities['Device'] = {
                                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                                Network: {
                                    IPFilter: false,
                                    ZeroConfiguration: false,
                                    IPVersion6: false,
                                    DynDNS: false,
                                    Extension: {
                                        Dot11Configuration: false,
                                        Extension: {}
                                    }
                                },
                                System: {
                                    DiscoveryResolve: false,
                                    DiscoveryBye: false,
                                    RemoteDiscovery: false,
                                    SystemBackup: false,
                                    SystemLogging: false,
                                    FirmwareUpgrade: false,
                                    SupportedVersions: {
                                        Major: 2,
                                        Minor: 5
                                    },
                                    Extension: {
                                        HttpFirmwareUpgrade: false,
                                        HttpSystemBackup: false,
                                        HttpSystemLogging: false,
                                        HttpSupportInformation: false,
                                        Extension: {}
                                    }
                                },
                                IO: {
                                    InputConnectors: 0,
                                    RelayOutputs: 1,
                                    Extension: {
                                        Auxiliary: false,
                                        AuxiliaryCommands: '',
                                        Extension: {}
                                    }
                                },
                                Security: {
                                    'TLS1.1': false,
                                    'TLS1.2': false,
                                    OnboardKeyGeneration: false,
                                    AccessPolicyConfig: false,
                                    'X.509Token': false,
                                    SAMLToken: false,
                                    KerberosToken: false,
                                    RELToken: false,
                                    Extension: {
                                        'TLS1.0': false,
                                        Extension: {
                                            Dot1X: false,
                                            RemoteUserHandling: false
                                        }
                                    }
                                },
                                Extension: {}
                            };
                        }
                        if (args.Category === undefined || args.Category == 'All' || args.Category == 'Media') {
                            response.Capabilities['Media'] = {
                                XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                                StreamingCapabilities: {
                                    RTPMulticast: false,
                                    RTP_TCP: true,
                                    RTP_RTSP_TCP: true,
                                    Extension: {}
                                },
                                Extension: {
                                    ProfileCapabilities: {
                                        MaximumNumberOfProfiles: this.profiles.length
                                    }
                                }
                            }
                        }

                        return response;
                    },

                    GetServices: (args) => {
                        return {
                            Service: [
                                {
                                    Namespace: 'http://www.onvif.org/ver10/device/wsdl',
                                    XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service`,
                                    Version: {
                                        Major: 2,
                                        Minor: 5,
                                    }
                                },
                                {
                                    Namespace: 'http://www.onvif.org/ver10/media/wsdl',
                                    XAddr: `http://${this.config.hostname}:${this.config.ports.server}/onvif/media_service`,
                                    Version: {
                                        Major: 2,
                                        Minor: 5,
                                    }
                                }
                            ]
                        };
                    },

                    GetDeviceInformation: (args) => {
                        return {
                            Manufacturer: 'rtsp-2-onvif',
                            Model: `${this.config.name}`,
                            FirmwareVersion: '1.0.0',
                            SerialNumber: `${this.config.name.replace(' ', '_')}-0000`,
                            HardwareId: `${this.config.name.replace(' ', '_')}-1001`
                        };
                    }

                }
            },

            MediaService: {
                Media: {
                    GetProfiles: (args) => {
                        return {
                            Profiles: this.profiles
                        };
                    },

                    GetVideoSources: (args) => {
                        return {
                            VideoSources: [
                                this.videoSource
                            ]
                        };
                    },

                    GetSnapshotUri: (args) => {
                        let uri = `http://${this.config.hostname}:${this.config.ports.server}/snapshot.png`;
                        if (args.ProfileToken == 'sub_stream' && this.config.lowQuality && this.config.lowQuality.snapshot)
                            uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.lowQuality.snapshot}`;
                        else if (this.config.highQuality.snapshot)
                            uri = `http://${this.config.hostname}:${this.config.ports.snapshot}${this.config.highQuality.snapshot}`;

                        return {
                            MediaUri: {
                                Uri: uri,
                                InvalidAfterConnect: false,
                                InvalidAfterReboot: false,
                                Timeout: 'PT30S'
                            }
                        };
                    },

                    GetStreamUri: (args) => {
                        let path = this.config.highQuality.rtsp;
                        if (args.ProfileToken == 'sub_stream' && this.config.lowQuality)
                            path = this.config.lowQuality.rtsp;

                        return {
                            MediaUri: {
                                Uri: `rtsp://${this.config.hostname}:${this.config.ports.rtsp}${path}`,
                                InvalidAfterConnect: false,
                                InvalidAfterReboot: false,
                                Timeout: 'PT30S'
                            }
                        };
                    }
                }
            }
        };
    }

    startHttpServer() {
        this.logger.info(`SERVER: ${this.config.name} - HTTP listening on ${this.config.hostname}:${this.config.ports.server}`);

        const self = this;
        
        // Create basic HTTP server
        this.server = http.createServer();
        
        // Start listening first
        this.server.listen(this.config.ports.server, this.config.hostname, () => {
            // Now set up SOAP services after server is listening
            try {
                const wsdlPath = path.join(process.cwd(), 'wsdl', 'device_service.wsdl');
                const deviceWsdl = fs.readFileSync(wsdlPath, 'utf8');
                
                this.deviceService = soap.listen(this.server, {
                    path: '/onvif/device_service',
                    services: this.onvif,
                    xml: deviceWsdl,
                    // No authentication required - accept all requests
                    suppressStack: true,
                    oneWay: false
                });
                
                // Disable security validation
                if (this.deviceService.setSecurity) {
                    this.deviceService.setSecurity(null);
                }
            } catch (err) {
                this.logger.error(`Failed to start device service: ${err.message}`);
                this.logger.error(err.stack);
            }

            try {
                const wsdlPath = path.join(process.cwd(), 'wsdl', 'media_service.wsdl');
                const mediaWsdl = fs.readFileSync(wsdlPath, 'utf8');
                
                this.mediaService = soap.listen(this.server, {
                    path: '/onvif/media_service',
                    services: this.onvif,
                    xml: mediaWsdl,
                    // No authentication required - accept all requests
                    suppressStack: true,
                    oneWay: false
                });
                
                // Disable security validation
                if (this.mediaService.setSecurity) {
                    this.mediaService.setSecurity(null);
                }
            } catch (err) {
                this.logger.error(`Failed to start media service: ${err.message}`);
                this.logger.error(err.stack);
            }
            
            // Add snapshot handler and logging after SOAP is set up
            const listeners = this.server.listeners('request');
            const soapListener = listeners[listeners.length - 1];
            
            if (soapListener) {
                this.server.removeAllListeners('request');
                
                this.server.on('request', (request, response) => {
                    const pathname = url.parse(request.url).pathname;
                    
                    // Log requests in debug mode
                    if (process.env.DEBUG) {
                        self.logger.debug(`REQUEST: ${request.method} ${pathname} from ${request.socket.remoteAddress}`);
                    }
                    
                    if (pathname === '/snapshot.png') {
                        try {
                            const imagePath = path.join(process.cwd(), 'resources', 'snapshot.png');
                            const image = fs.readFileSync(imagePath);
                            response.writeHead(200, { 'Content-Type': 'image/png' });
                            response.end(image, 'binary');
                        } catch (err) {
                            response.writeHead(404, { 'Content-Type': 'text/plain' });
                            response.end('Snapshot not found');
                        }
                    } else if (pathname === '/onvif/device_service' && request.method === 'GET') {
                        // Serve WSDL file when requested via GET
                        try {
                            const wsdlPath = path.join(process.cwd(), 'wsdl', 'device_service.wsdl');
                            const wsdl = fs.readFileSync(wsdlPath, 'utf8');
                            response.writeHead(200, { 'Content-Type': 'text/xml' });
                            response.end(wsdl);
                        } catch (err) {
                            response.writeHead(500, { 'Content-Type': 'text/plain' });
                            response.end('WSDL not found');
                        }
                    } else if (pathname === '/onvif/media_service' && request.method === 'GET') {
                        // Serve WSDL file when requested via GET
                        try {
                            const wsdlPath = path.join(process.cwd(), 'wsdl', 'media_service.wsdl');
                            const wsdl = fs.readFileSync(wsdlPath, 'utf8');
                            response.writeHead(200, { 'Content-Type': 'text/xml' });
                            response.end(wsdl);
                        } catch (err) {
                            response.writeHead(500, { 'Content-Type': 'text/plain' });
                            response.end('WSDL not found');
                        }
                    } else {
                        // Let SOAP handle all other requests
                        soapListener(request, response);
                    }
                });
            }
        });
    }

    enableDebugOutput() {
        const self = this;
        
        if (this.deviceService) {
            this.deviceService.log = function(type, data, req){
                if (type === 'error') {
                    self.logger.error(`SERVER ERROR: ${data}`);
                    if (data && data.stack) {
                        self.logger.error(`Stack trace: ${data.stack}`);
                    }
                } else {
                    self.logger.debug(`SERVER: ${data}`);
                }
            };
        }
        
        if (this.mediaService) {
            this.mediaService.log = function(type, data, req){
                if (type === 'error') {
                    self.logger.error(`SERVER ERROR: ${data}`);
                    if (data && data.stack) {
                        self.logger.error(`Stack trace: ${data.stack}`);
                    }
                } else {
                    self.logger.debug(`SERVER: ${data}`);
                }
            };
        }
    }

    startDiscovery() {
        this.discoveryMessageNo = 0;
        this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.discoverySocket.on('message', (message, remote) => {

            this.logger.debug(`SERVER: ${this.config.name} - Discovery request from ${remote.address}:${remote.port}`);

            xml2js.parseString(message.toString(), { tagNameProcessors: [xml2js['processors'].stripPrefix] }, (err, result) => {
                let probeUuid = result['Envelope']['Header'][0]['MessageID'][0];
                let probeType = '';
                try {
                    probeType = result['Envelope']['Body'][0]['Probe'][0]['Types'][0];
                } catch (err) {
                    probeType = '';
                }

                if (typeof probeType === 'object')
                    probeType = probeType._;

                if (probeType === '' || probeType.indexOf('NetworkVideoTransmitter') > -1) {
                    let response =
                        `<?xml version="1.0" encoding="UTF-8"?>
                        <SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
                            <SOAP-ENV:Header>
                                <wsa:MessageID>uuid:${uuidv1()}</wsa:MessageID>
                                <wsa:RelatesTo>${probeUuid}</wsa:RelatesTo>
                                <wsa:To SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:To>
                                <wsa:Action SOAP-ENV:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action>
                                <d:AppSequence SOAP-ENV:mustUnderstand="true" MessageNumber="${this.discoveryMessageNo}" InstanceId="1234567890"/>
                            </SOAP-ENV:Header>
                            <SOAP-ENV:Body>
                                <d:ProbeMatches>
                                    <d:ProbeMatch>
                                        <wsa:EndpointReference>
                                            <wsa:Address>urn:uuid:${this.config.uuid}</wsa:Address>
                                        </wsa:EndpointReference>
                                        <d:Types>dn:NetworkVideoTransmitter</d:Types>
                                        <d:Scopes>
                                            onvif://www.onvif.org/type/video_encoder
                                            onvif://www.onvif.org/type/ptz
                                            onvif://www.onvif.org/hardware/onvif
                                            onvif://www.onvif.org/name/${this.config.name}
                                            onvif://www.onvif.org/location/
                                        </d:Scopes>
                                        <d:XAddrs>http://${this.config.hostname}:${this.config.ports.server}/onvif/device_service</d:XAddrs>
                                        <d:MetadataVersion>1</d:MetadataVersion>
                                    </d:ProbeMatch>
                                </d:ProbeMatches>
                            </SOAP-ENV:Body>
                        </SOAP-ENV:Envelope>`;

                    this.discoveryMessageNo++;
                    let responseBuffer = Buffer.from(response);
                    return dgram.createSocket('udp4').send(responseBuffer, 0, responseBuffer.length, remote.port, remote.address);
                }
            });
        });

        this.discoverySocket.bind(3702, () => {
            return this.discoverySocket.addMembership('239.255.255.250', this.config.hostname);
        });
    }

    getHostname() {
        return this.config.hostname;
    }
};