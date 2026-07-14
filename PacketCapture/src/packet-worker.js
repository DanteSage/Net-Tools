// Web Worker: 处理数据包过滤等计算密集型任务

let allPackets = [];

self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'add':
      // 批量添加数据包
      if (Array.isArray(data)) {
        allPackets.push(...data);
      } else {
        allPackets.push(data);
      }
      self.postMessage({ type: 'count', total: allPackets.length });
      break;
      
    case 'filter':
      // 过滤数据包
      const { searchTerm, startIndex, endIndex } = data;
      const filtered = filterPackets(searchTerm, startIndex, endIndex);
      self.postMessage({ type: 'filtered', data: filtered });
      break;
      
    case 'getRange':
      // 获取指定范围的数据包（用于虚拟滚动）
      const { start, end, search, isPreload } = data;
      const result = getRangePackets(start, end, search);
      self.postMessage({ type: 'range', data: result, isPreload: !!isPreload });
      break;
      
    case 'clear':
      // 清空数据
      allPackets = [];
      self.postMessage({ type: 'cleared' });
      break;
      
    case 'getFilteredCount':
      // 获取过滤后的数量
      const count = getFilteredCount(data.searchTerm);
      self.postMessage({ type: 'filteredCount', count });
      break;
      
    case 'getPacketById':
      // 根据 ID 获取数据包
      const packet = allPackets.find(p => p.id === data.id);
      self.postMessage({ type: 'packet', data: packet });
      break;
  }
};

function filterPackets(searchTerm, startIndex = 0, endIndex = -1) {
  let source = allPackets;
  if (endIndex > 0) {
    source = allPackets.slice(startIndex, endIndex);
  }
  
  if (!searchTerm) {
    return { packets: source, indices: source.map((_, i) => startIndex + i) };
  }
  
  const term = searchTerm.toLowerCase();
  const packets = [];
  const indices = [];
  
  for (let i = 0; i < source.length; i++) {
    const packet = source[i];
    const searchStr = `${packet.srcIp} ${packet.dstIp} ${packet.srcPort} ${packet.dstPort} ${packet.protocol} ${packet.info}`.toLowerCase();
    if (searchStr.includes(term)) {
      packets.push(packet);
      indices.push(startIndex + i);
    }
  }
  
  return { packets, indices };
}

function getRangePackets(start, end, searchTerm) {
  if (!searchTerm) {
    // 无过滤，直接切片
    const packets = allPackets.slice(start, end);
    return { 
      packets, 
      total: allPackets.length,
      start,
      end: Math.min(end, allPackets.length)
    };
  }
  
  // 有过滤，需要遍历找到匹配的数据包
  const term = searchTerm.toLowerCase();
  const packets = [];
  let matchCount = 0;
  let currentIndex = 0;
  
  for (let i = 0; i < allPackets.length && packets.length < (end - start); i++) {
    const packet = allPackets[i];
    const searchStr = `${packet.srcIp} ${packet.dstIp} ${packet.srcPort} ${packet.dstPort} ${packet.protocol} ${packet.info}`.toLowerCase();
    if (searchStr.includes(term)) {
      if (currentIndex >= start) {
        packets.push(packet);
      }
      currentIndex++;
    }
    matchCount++;
  }
  
  // 计算总匹配数
  const totalFiltered = getFilteredCount(searchTerm);
  
  return {
    packets,
    total: totalFiltered,
    start,
    end: start + packets.length
  };
}

function getFilteredCount(searchTerm) {
  if (!searchTerm) return allPackets.length;
  
  const term = searchTerm.toLowerCase();
  let count = 0;
  
  for (const packet of allPackets) {
    const searchStr = `${packet.srcIp} ${packet.dstIp} ${packet.srcPort} ${packet.dstPort} ${packet.protocol} ${packet.info}`.toLowerCase();
    if (searchStr.includes(term)) {
      count++;
    }
  }
  
  return count;
}
