/**
 * Apply an OsmChange (.osc) file onto map.osm.
 * Usage: node backend/scripts/apply-osc.js [osc-file] [map.osm]
 */
const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const ROOT = path.join(__dirname, '..', '..');
const MAP_FILE = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(ROOT, 'map.osm');
const OSC_FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'changes (2).osc');

function parseXml(file) {
  return new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml');
}

function childTags(el) {
  const tags = {};
  for (const t of Array.from(el.getElementsByTagName('tag'))) {
    tags[t.getAttribute('k')] = t.getAttribute('v');
  }
  return tags;
}

function setTags(el, tags, doc) {
  Array.from(el.getElementsByTagName('tag')).forEach(t => el.removeChild(t));
  for (const [k, v] of Object.entries(tags)) {
    const tag = doc.createElement('tag');
    tag.setAttribute('k', k);
    tag.setAttribute('v', v);
    el.appendChild(tag);
  }
}

function makeNode(doc, id, lat, lon, tags = {}) {
  const node = doc.createElement('node');
  node.setAttribute('id', id);
  node.setAttribute('visible', 'true');
  node.setAttribute('version', '1');
  node.setAttribute('lat', lat);
  node.setAttribute('lon', lon);
  setTags(node, tags, doc);
  return node;
}

function makeWay(doc, id, ndRefs, tags = {}) {
  const way = doc.createElement('way');
  way.setAttribute('id', id);
  way.setAttribute('visible', 'true');
  way.setAttribute('version', '1');
  for (const ref of ndRefs) {
    const nd = doc.createElement('nd');
    nd.setAttribute('ref', ref);
    way.appendChild(nd);
  }
  setTags(way, tags, doc);
  return way;
}

function indexElements(osm) {
  const nodes = new Map();
  const ways = new Map();
  for (const el of elementChildren(osm)) {
    if (el.nodeName === 'node') nodes.set(el.getAttribute('id'), el);
    if (el.nodeName === 'way') ways.set(el.getAttribute('id'), el);
  }
  return { nodes, ways };
}

function elementChildren(parent) {
  return Array.from(parent.childNodes).filter(n => n.nodeType === 1);
}

function maxPositiveId(osm) {
  let max = 0;
  for (const el of elementChildren(osm)) {
    const id = parseInt(el.getAttribute('id'), 10);
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

function nodeRefsInUse(ways) {
  const used = new Set();
  for (const way of ways.values()) {
    for (const nd of Array.from(way.getElementsByTagName('nd'))) {
      used.add(nd.getAttribute('ref'));
    }
  }
  return used;
}

function applyOsc() {
  const mapDoc = parseXml(MAP_FILE);
  const oscDoc = parseXml(OSC_FILE);
  const osm = mapDoc.getElementsByTagName('osm')[0];
  const { nodes, ways } = indexElements(osm);

  let nextId = maxPositiveId(osm) + 1;
  const idMap = {};
  const resolveId = (raw, kind = 'node') => {
    const s = String(raw);
    if (!s.startsWith('-')) return s;
    const key = `${kind}:${s}`;
    if (!idMap[key]) idMap[key] = String(nextId++);
    return idMap[key];
  };

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let created = 0, modified = 0, deleted = 0;

  const create = oscDoc.getElementsByTagName('create')[0];
  if (create) {
    for (const el of elementChildren(create)) {
      if (el.nodeName === 'node') {
        const id = resolveId(el.getAttribute('id'), 'node');
        const node = makeNode(mapDoc, id, el.getAttribute('lat'), el.getAttribute('lon'), childTags(el));
        osm.appendChild(node);
        nodes.set(id, node);
        created++;
      } else if (el.nodeName === 'way') {
        const id = resolveId(el.getAttribute('id'), 'way');
        const refs = Array.from(el.getElementsByTagName('nd')).map(nd => resolveId(nd.getAttribute('ref'), 'node'));
        const way = makeWay(mapDoc, id, refs, childTags(el));
        osm.appendChild(way);
        ways.set(id, way);
        created++;
      }
    }
  }

  const modify = oscDoc.getElementsByTagName('modify')[0];
  if (modify) {
    for (const el of elementChildren(modify)) {
      if (el.nodeName === 'node') {
        const rawId = el.getAttribute('id');
        const id = resolveId(rawId, 'node');
        let node = nodes.get(id);
        if (!node) {
          node = makeNode(mapDoc, id, el.getAttribute('lat'), el.getAttribute('lon'), childTags(el));
          osm.appendChild(node);
          nodes.set(id, node);
          created++;
          continue;
        }
        if (el.hasAttribute('lat')) node.setAttribute('lat', el.getAttribute('lat'));
        if (el.hasAttribute('lon')) node.setAttribute('lon', el.getAttribute('lon'));
        const tags = childTags(el);
        if (Object.keys(tags).length) setTags(node, tags, mapDoc);
        node.setAttribute('version', String((parseInt(node.getAttribute('version') || '1', 10)) + 1));
        modified++;
      } else if (el.nodeName === 'way') {
        const id = resolveId(el.getAttribute('id'), 'way');
        let way = ways.get(id);
        const refs = Array.from(el.getElementsByTagName('nd')).map(nd => resolveId(nd.getAttribute('ref'), 'node'));
        const tags = childTags(el);
        if (!way) {
          way = makeWay(mapDoc, id, refs, tags);
          osm.appendChild(way);
          ways.set(id, way);
          created++;
          continue;
        }
        Array.from(way.getElementsByTagName('nd')).forEach(nd => way.removeChild(nd));
        for (const ref of refs) {
          const nd = mapDoc.createElement('nd');
          nd.setAttribute('ref', ref);
          way.appendChild(nd);
        }
        if (Object.keys(tags).length) setTags(way, tags, mapDoc);
        way.setAttribute('version', String((parseInt(way.getAttribute('version') || '1', 10)) + 1));
        modified++;
      }
    }
  }

  const del = oscDoc.getElementsByTagName('delete')[0];
  if (del) {
    const deleteWays = [];
    const deleteNodes = [];
    for (const el of elementChildren(del)) {
      if (el.nodeName === 'way') deleteWays.push(el.getAttribute('id'));
      if (el.nodeName === 'node') deleteNodes.push(el.getAttribute('id'));
    }

    for (const wayId of deleteWays) {
      const way = ways.get(String(wayId));
      if (!way) continue;
      osm.removeChild(way);
      ways.delete(String(wayId));
      deleted++;
    }

    const used = nodeRefsInUse(ways);
    for (const nodeId of deleteNodes) {
      const id = String(nodeId);
      if (used.has(id)) continue;
      const node = nodes.get(id);
      if (!node) continue;
      osm.removeChild(node);
      nodes.delete(id);
      deleted++;
    }
  }

  osm.setAttribute('timestamp', stamp);
  const xml = new XMLSerializer().serializeToString(mapDoc);
  fs.writeFileSync(MAP_FILE, xml.startsWith('<?xml') ? xml : '<?xml version="1.0" encoding="UTF-8"?>\n' + xml);

  console.log(`Applied ${path.basename(OSC_FILE)} → ${path.basename(MAP_FILE)}`);
  console.log(`  created : ${created}`);
  console.log(`  modified: ${modified}`);
  console.log(`  deleted : ${deleted}`);
  console.log(`  id remap: ${Object.keys(idMap).length} negative ids`);
  if (Object.keys(idMap).length) {
    for (const [neg, pos] of Object.entries(idMap)) console.log(`    ${neg} → ${pos}`);
  }
}

applyOsc();
