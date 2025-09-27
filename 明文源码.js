import { connect } from 'cloudflare:sockets';

// 配置常量
const CONFIG = {
    expire: 4102329600, // 2099-12-31
    defaultPorts: {
        http: ["8080", "8880", "2052", "2082", "2086", "2095"],
        https: ["2053", "2083", "2087", "2096", "8443"]
    },
    protocolType: 'vmess',
    defaultDLS: 8,
    remarkIndex: 1
};

// 核心配置
let userID = '';
let proxyIP = '';
let DNS64Server = '';
let subConverter = 'SUBAPI.CMLiussss.net';
let subConfig = 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_MultiMode.ini';

export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            const userAgent = request.headers.get('User-Agent') || '';
            
            // 初始化用户ID
            userID = await initializeUserID(env, userAgent);
            if (!userID) {
                return new Response('请设置UUID变量', { status: 404 });
            }

            // 处理WebSocket升级请求
            if (request.headers.get('Upgrade') === 'websocket') {
                return await handleWebSocket(request, env);
            }

            // 处理HTTP请求
            return await handleHTTPRequest(request, env, url, userAgent);
            
        } catch (error) {
            return new Response(`Error: ${error.message}`, { status: 500 });
        }
    }
};

// 初始化用户ID
async function initializeUserID(env, userAgent) {
    let uuid = env.UUID || env.uuid || env.PASSWORD || env.pswd || userID;
    
    if (env.KEY || env.TOKEN || (uuid && !isValidUUID(uuid))) {
        return await generateDynamicUUID(uuid);
    }
    
    return uuid;
}

// WebSocket处理器
async function handleWebSocket(request, env) {
    const url = new URL(request.url);
    
    // 解析代理配置
    const proxyConfig = parseProxyConfig(url);
    
    // 创建WebSocket对
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    
    await handleWebSocketStream(server, proxyConfig);
    
    return new Response(null, {
        status: 101,
        webSocket: client
    });
}

// WebSocket数据流处理
async function handleWebSocketStream(webSocket, proxyConfig) {
    const stream = createReadableWebSocketStream(webSocket);
    
    await stream.pipeTo(new WritableStream({
        async write(chunk) {
            await processWebSocketData(chunk, webSocket, proxyConfig);
        },
        close() {
            safeCloseWebSocket(webSocket);
        },
        abort(reason) {
            console.error('WebSocket stream aborted:', reason);
        }
    })).catch(error => {
        console.error('WebSocket stream error:', error);
    });
}

// 处理WebSocket数据
async function processWebSocketData(chunk, webSocket, proxyConfig) {
    const header = parseVmessHeader(chunk, userID);
    if (header.hasError) {
        throw new Error(header.message);
    }

    if (header.isUDP) {
        await handleUDPRequest(chunk, webSocket, header);
        return;
    }

    await handleTCPRequest(header, chunk, webSocket, proxyConfig);
}

// TCP请求处理
async function handleTCPRequest(header, chunk, webSocket, proxyConfig) {
    const { addressRemote, portRemote } = header;
    
    try {
        const socket = await createConnection(addressRemote, portRemote, proxyConfig);
        await pipeSocketData(socket, webSocket, chunk);
    } catch (error) {
        console.error('TCP connection failed:', error);
        throw error;
    }
}

// 创建连接
async function createConnection(address, port, proxyConfig) {
    if (proxyConfig.socks5) {
        return await createSocks5Connection(address, port, proxyConfig.socks5);
    }
    
    if (proxyConfig.http) {
        return await createHTTPConnection(address, port, proxyConfig.http);
    }
    
    return connect({ hostname: address, port });
}

// SOCKS5连接
async function createSocks5Connection(address, port, socksConfig) {
    const socket = connect({
        hostname: socksConfig.hostname,
        port: socksConfig.port
    });

    await authenticateSocks5(socket, socksConfig);
    await requestSocks5Connection(socket, address, port);
    
    return socket;
}

// HTTP连接
async function createHTTPConnection(address, port, httpConfig) {
    const socket = connect({
        hostname: httpConfig.hostname,
        port: httpConfig.port
    });

    await sendHTTPConnectRequest(socket, address, port, httpConfig);
    await verifyHTTPResponse(socket);
    
    return socket;
}

// 管道数据传输
async function pipeSocketData(socket, webSocket, initialData) {
    const writer = socket.writable.getWriter();
    await writer.write(initialData);
    writer.releaseLock();

    await socket.readable.pipeTo(new WritableStream({
        async write(chunk) {
            if (webSocket.readyState === 1) {
                webSocket.send(chunk);
            }
        },
        close() {
            safeCloseWebSocket(webSocket);
        }
    }));
}

// HTTP请求处理
async function handleHTTPRequest(request, env, url, userAgent) {
    const path = url.pathname.toLowerCase();
    
    if (path === '/') {
        return await handleRootRequest(request, env, url);
    }
    
    if (path === `/${userID}` || path === `/${userID}/`) {
        return await generateSubscription(request, env, userAgent);
    }
    
    if (path === `/${userID}/edit`) {
        return await handleEditPage(request, env);
    }
    
    if (path === `/${userID}/bestip`) {
        return await handleBestIP(request, env);
    }
    
    return new Response('Not Found', { status: 404 });
}

// 生成订阅配置
async function generateSubscription(request, env, userAgent) {
    const url = new URL(request.url);
    const host = request.headers.get('Host');
    
    const config = await buildSubscriptionConfig(userID, host, url, env);
    
    const headers = {
        "Content-Type": "text/plain;charset=utf-8",
        "Content-Disposition": `attachment; filename=edgetunnel`,
        "Profile-Update-Interval": "6"
    };
    
    return new Response(config, { headers });
}

// 构建订阅配置
async function buildSubscriptionConfig(uuid, host, url, env) {
    const useTLS = !host.includes('.workers.dev') && !url.searchParams.has('notls');
    const port = useTLS ? 443 : 80;
    const security = useTLS ? 'tls' : '';
    
    const config = {
        v: "2",
        ps: "Edge Tunnel",
        add: host,
        port: port,
        id: uuid,
        aid: "0",
        scy: "auto",
        net: "ws",
        type: "none",
        host: host,
        path: "/?ed=2560",
        tls: security,
        sni: host,
        alpn: "",
        fp: "chrome"
    };
    
    return `vmess://${btoa(JSON.stringify(config))}`;
}

// 工具函数
function isValidUUID(uuid) {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
}

function safeCloseWebSocket(socket) {
    if (socket.readyState === 1 || socket.readyState === 2) {
        try {
            socket.close();
        } catch (error) {
            console.error('Error closing WebSocket:', error);
        }
    }
}

function createReadableWebSocketStream(webSocket) {
    return new ReadableStream({
        start(controller) {
            webSocket.addEventListener('message', (event) => {
                controller.enqueue(event.data);
            });
            
            webSocket.addEventListener('close', () => {
                controller.close();
            });
            
            webSocket.addEventListener('error', (error) => {
                controller.error(error);
            });
        },
        cancel() {
            safeCloseWebSocket(webSocket);
        }
    });
}

// 简化的VMess头解析
function parseVmessHeader(buffer, userId) {
    if (buffer.byteLength < 24) {
        return { hasError: true, message: 'Invalid data length' };
    }
    
    // 简化版本：实际需要完整解析
    return {
        hasError: false,
        addressRemote: 'example.com',
        portRemote: 443,
        addressType: 2,
        isUDP: false,
        rawDataIndex: 16
    };
}

// 动态UUID生成（简化）
async function generateDynamicUUID(seed) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(seed + Date.now()));
    const hashArray = Array.from(new Uint8Array(hash));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// 代理配置解析
function parseProxyConfig(url) {
    const config = {};
    
    if (url.searchParams.has('socks5')) {
        config.socks5 = parseSocks5Config(url.searchParams.get('socks5'));
    }
    
    if (url.searchParams.has('http')) {
        config.http = parseHTTPConfig(url.searchParams.get('http'));
    }
    
    return config;
}

function parseSocks5Config(address) {
    const [auth, server] = address.split('@');
    const [hostname, port] = server.split(':');
    
    return {
        hostname,
        port: parseInt(port) || 1080,
        username: auth.split(':')[0],
        password: auth.split(':')[1]
    };
}

function parseHTTPConfig(address) {
    const [auth, server] = address.split('@');
    const [hostname, port] = server.split(':');
    
    return {
        hostname,
        port: parseInt(port) || 8080,
        username: auth.split(':')[0],
        password: auth.split(':')[1]
    };
}

// 占位函数 - 需要根据实际需求实现
async function handleRootRequest(request, env, url) {
    return new Response('Edge Tunnel Service');
}

async function handleEditPage(request, env) {
    return new Response('Edit functionality would be here');
}

async function handleBestIP(request, env) {
    return new Response('Best IP functionality would be here');
}

async function handleUDPRequest(chunk, webSocket, header) {
    // UDP处理逻辑
    webSocket.send(new Uint8Array([0x00, 0x00])); // 简单响应
}

async function authenticateSocks5(socket, config) {
    // SOCKS5认证逻辑
    const writer = socket.writable.getWriter();
    await writer.write(new Uint8Array([0x05, 0x01, 0x00]));
    writer.releaseLock();
}

async function requestSocks5Connection(socket, address, port) {
    // SOCKS5连接请求
    const writer = socket.writable.getWriter();
    // 简化实现
    await writer.write(new Uint8Array([0x05, 0x01, 0x00, 0x01]));
    writer.releaseLock();
}

async function sendHTTPConnectRequest(socket, address, port, config) {
    // HTTP CONNECT请求
    const writer = socket.writable.getWriter();
    const request = `CONNECT ${address}:${port} HTTP/1.1\r\nHost: ${address}:${port}\r\n\r\n`;
    await writer.write(new TextEncoder().encode(request));
    writer.releaseLock();
}

async function verifyHTTPResponse(socket) {
    // 验证HTTP响应
    // 简化实现
}
