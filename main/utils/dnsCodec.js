/**
 * DNS 报文编解码器
 * 实现 RFC 1035 / RFC 3596 (AAAA) / RFC 6844 (CAA) / RFC 2782 (SRV)
 * @module dnsCodec
 */

// ==================== 常量定义 ====================

const TYPES = {
    A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12,
    MX: 15, TXT: 16, AAAA: 28, SRV: 33,
    OPT: 41, DS: 43, RRSIG: 46, NSEC: 47, DNSKEY: 48,
    HTTPS: 65, CAA: 257, ANY: 255
};

const TYPE_NAMES = Object.fromEntries(
    Object.entries(TYPES).map(([k, v]) => [v, k])
);

const RCODES = {
    0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN',
    4: 'NOTIMP', 5: 'REFUSED', 6: 'YXDOMAIN', 7: 'YXRRSET',
    8: 'NXRRSET', 9: 'NOTAUTH', 10: 'NOTZONE'
};

// ==================== 域名编解码 ====================

/**
 * 编码域名（无压缩）
 * 例如：example.com -> [7]example[3]com[0]
 */
function encodeName(name) {
    if (!name || name === '.' || name === '') {
        return Buffer.from([0]);
    }
    const cleaned = name.replace(/\.$/, '');
    const parts = cleaned.split('.').filter(p => p.length > 0);
    const buffers = [];
    for (const p of parts) {
        const bytes = Buffer.from(p, 'utf8');
        if (bytes.length > 63) throw new Error('Label too long: ' + p);
        buffers.push(Buffer.from([bytes.length]));
        buffers.push(bytes);
    }
    buffers.push(Buffer.from([0]));
    return Buffer.concat(buffers);
}

/**
 * 解码域名（支持压缩指针）
 * @returns {{name: string, endPos: number}}
 */
function decodeName(buffer, offset) {
    const parts = [];
    let pos = offset;
    let jumped = false;
    let endPos = offset;
    let safety = 0;

    while (safety++ < 256) {
        if (pos >= buffer.length) break;
        const len = buffer[pos];
        if (len === 0) {
            pos++;
            if (!jumped) endPos = pos;
            break;
        }
        if ((len & 0xC0) === 0xC0) {
            // 压缩指针
            if (pos + 1 >= buffer.length) break;
            const ptr = ((len & 0x3F) << 8) | buffer[pos + 1];
            if (!jumped) {
                endPos = pos + 2;
                jumped = true;
            }
            pos = ptr;
            continue;
        }
        if (pos + 1 + len > buffer.length) break;
        parts.push(buffer.slice(pos + 1, pos + 1 + len).toString('utf8'));
        pos += 1 + len;
    }
    return { name: parts.join('.') || '.', endPos };
}

// ==================== 查询编码 ====================

/**
 * 编码 DNS 查询报文
 * @param {string} name - 域名
 * @param {number} type - 记录类型
 * @param {Object} options
 * @returns {Buffer}
 */
function encodeQuery(name, type, options = {}) {
    const { id = Math.floor(Math.random() * 65536), recursion = true, edns = true } = options;
    const flags = recursion ? 0x0100 : 0x0000; // RD bit
    const header = Buffer.alloc(12);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(flags, 2);
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(0, 6); // ANCOUNT
    header.writeUInt16BE(0, 8); // NSCOUNT
    header.writeUInt16BE(edns ? 1 : 0, 10); // ARCOUNT (含 OPT)

    const qname = encodeName(name);
    const qfooter = Buffer.alloc(4);
    qfooter.writeUInt16BE(type, 0);
    qfooter.writeUInt16BE(1, 2); // IN class

    const parts = [header, qname, qfooter];

    if (edns) {
        // OPT 伪资源记录：name=root, type=41, class=4096(UDP size), TTL=0, RDLENGTH=0
        const opt = Buffer.alloc(11);
        opt[0] = 0; // root name
        opt.writeUInt16BE(41, 1); // OPT type
        opt.writeUInt16BE(4096, 3); // UDP payload size
        opt.writeUInt32BE(0, 5); // TTL (extended rcode + flags)
        opt.writeUInt16BE(0, 9); // RDLENGTH
        parts.push(opt);
    }

    return Buffer.concat(parts);
}

// ==================== 响应解码 ====================

/**
 * 解析 RDATA 段为可读字符串
 */
function parseRdata(buffer, offset, length, type) {
    try {
        switch (type) {
            case TYPES.A:
                return Array.from(buffer.slice(offset, offset + 4)).join('.');
            case TYPES.AAAA: {
                const groups = [];
                for (let i = 0; i < 16; i += 2) {
                    groups.push(buffer.readUInt16BE(offset + i).toString(16));
                }
                return compressIpv6(groups.join(':'));
            }
            case TYPES.NS:
            case TYPES.CNAME:
            case TYPES.PTR:
                return decodeName(buffer, offset).name;
            case TYPES.MX: {
                const pref = buffer.readUInt16BE(offset);
                const exchange = decodeName(buffer, offset + 2).name;
                return { preference: pref, exchange, str: `${pref} ${exchange}` };
            }
            case TYPES.TXT: {
                let pos = offset;
                const end = offset + length;
                const strs = [];
                while (pos < end) {
                    const len = buffer[pos];
                    strs.push(buffer.slice(pos + 1, pos + 1 + len).toString('utf8'));
                    pos += 1 + len;
                }
                return strs.join('');
            }
            case TYPES.SOA: {
                const mn = decodeName(buffer, offset);
                const rn = decodeName(buffer, mn.endPos);
                const serial = buffer.readUInt32BE(rn.endPos);
                const refresh = buffer.readUInt32BE(rn.endPos + 4);
                const retry = buffer.readUInt32BE(rn.endPos + 8);
                const expire = buffer.readUInt32BE(rn.endPos + 12);
                const minimum = buffer.readUInt32BE(rn.endPos + 16);
                return {
                    mname: mn.name, rname: rn.name,
                    serial, refresh, retry, expire, minimum,
                    str: `${mn.name} ${rn.name} ${serial} ${refresh} ${retry} ${expire} ${minimum}`
                };
            }
            case TYPES.SRV: {
                const priority = buffer.readUInt16BE(offset);
                const weight = buffer.readUInt16BE(offset + 2);
                const port = buffer.readUInt16BE(offset + 4);
                const target = decodeName(buffer, offset + 6).name;
                return {
                    priority, weight, port, target,
                    str: `${priority} ${weight} ${port} ${target}`
                };
            }
            case TYPES.CAA: {
                const flags = buffer[offset];
                const tagLen = buffer[offset + 1];
                const tag = buffer.slice(offset + 2, offset + 2 + tagLen).toString('utf8');
                const value = buffer.slice(offset + 2 + tagLen, offset + length).toString('utf8');
                return {
                    flags, tag, value,
                    str: `${flags} ${tag} "${value}"`
                };
            }
            case TYPES.DNSKEY: {
                const flags = buffer.readUInt16BE(offset);
                const protocol = buffer[offset + 2];
                const algorithm = buffer[offset + 3];
                const key = buffer.slice(offset + 4, offset + length).toString('base64');
                return `${flags} ${protocol} ${algorithm} ${key.slice(0, 40)}...`;
            }
            case TYPES.DS: {
                const keyTag = buffer.readUInt16BE(offset);
                const algorithm = buffer[offset + 2];
                const digestType = buffer[offset + 3];
                const digest = buffer.slice(offset + 4, offset + length).toString('hex').toUpperCase();
                return `${keyTag} ${algorithm} ${digestType} ${digest}`;
            }
            default:
                return buffer.slice(offset, offset + length).toString('hex');
        }
    } catch (e) {
        return `<解析失败: ${e.message}>`;
    }
}

/**
 * 压缩 IPv6 地址（::）
 */
function compressIpv6(addr) {
    return addr.replace(/(^|:)(0(:0)+)(:|$)/, (_, a, _b, _c, d) => {
        return a === '' && d === '' ? '::' : (a + '::' + d).replace(/^::+/, '::').replace(/::+$/, '::');
    }).replace(/(?:^|:)0+([0-9a-f])/g, (m) => m.replace(/0+(?=[0-9a-f])/, ''));
}

/**
 * 解码完整响应报文
 */
function decodeResponse(buffer) {
    if (buffer.length < 12) {
        throw new Error('响应报文过短');
    }
    const id = buffer.readUInt16BE(0);
    const flags = buffer.readUInt16BE(2);
    const qdcount = buffer.readUInt16BE(4);
    const ancount = buffer.readUInt16BE(6);
    const nscount = buffer.readUInt16BE(8);
    const arcount = buffer.readUInt16BE(10);

    const qr = (flags >> 15) & 1;
    const opcode = (flags >> 11) & 0x0F;
    const aa = (flags >> 10) & 1;
    const tc = (flags >> 9) & 1;
    const rd = (flags >> 8) & 1;
    const ra = (flags >> 7) & 1;
    const ad = (flags >> 5) & 1;
    const cd = (flags >> 4) & 1;
    const rcode = flags & 0x0F;

    let pos = 12;
    const questions = [];
    for (let i = 0; i < qdcount; i++) {
        const { name, endPos } = decodeName(buffer, pos);
        const qtype = buffer.readUInt16BE(endPos);
        const qclass = buffer.readUInt16BE(endPos + 2);
        questions.push({ name, type: qtype, typeName: TYPE_NAMES[qtype] || `TYPE${qtype}`, class: qclass });
        pos = endPos + 4;
    }

    const decodeRR = () => {
        const { name, endPos } = decodeName(buffer, pos);
        pos = endPos;
        const type = buffer.readUInt16BE(pos);
        const cls = buffer.readUInt16BE(pos + 2);
        const ttl = buffer.readUInt32BE(pos + 4);
        const rdlen = buffer.readUInt16BE(pos + 8);
        pos += 10;
        const data = parseRdata(buffer, pos, rdlen, type);
        const result = {
            name, type, typeName: TYPE_NAMES[type] || `TYPE${type}`,
            class: cls, ttl, rdlength: rdlen, data
        };
        pos += rdlen;
        return result;
    };

    const answers = [];
    for (let i = 0; i < ancount; i++) {
        try { answers.push(decodeRR()); } catch (e) { break; }
    }
    const authorities = [];
    for (let i = 0; i < nscount; i++) {
        try { authorities.push(decodeRR()); } catch (e) { break; }
    }
    const additionals = [];
    for (let i = 0; i < arcount; i++) {
        try { additionals.push(decodeRR()); } catch (e) { break; }
    }

    return {
        id, flags: { qr, opcode, aa, tc, rd, ra, ad, cd },
        rcode, rcodeName: RCODES[rcode] || `RCODE${rcode}`,
        questions, answers, authorities, additionals
    };
}

module.exports = {
    TYPES, TYPE_NAMES, RCODES,
    encodeName, decodeName,
    encodeQuery, decodeResponse, parseRdata
};
