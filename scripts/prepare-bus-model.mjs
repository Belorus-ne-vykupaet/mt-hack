// Convert Quaternius Public Transport Pack / Bus.obj (CC0) to a local GLB.
// Usage: node scripts/prepare-bus-model.mjs /path/to/Bus.obj
// Source: https://quaternius.com/packs/publictransport.html
import { readFileSync, writeFileSync } from 'node:fs';
import { Box3, Vector3, MeshStandardMaterial } from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
class NodeFileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
}
globalThis.FileReader = NodeFileReader;
const bus = new OBJLoader().parse(readFileSync(process.argv[2], 'utf8'));
// The source OBJ has flat placeholder materials. Use a blue city-bus livery.
const colors = { Bottom: '#2694de', Top: '#4aabe4', Windows: '#172e49', Details: '#153858', Bumper: '#bccdd8', Lights: '#fff4c9', Material: '#18232f' };
bus.traverse(mesh => {
  if (!mesh.isMesh) return;
  const material = m => new MeshStandardMaterial({ name: m.name, color: colors[m.name] || '#2694de', roughness: 0.75, metalness: 0.08 });
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material);
  // Original front is -X. Normalize to glTF +Z forward, +Y up.
  mesh.geometry.rotateY(Math.PI / 2);
});
const bounds = new Box3().setFromObject(bus), center = bounds.getCenter(new Vector3());
// deck.gl sizeMinPixels is multiplied by the mesh dimensions; use unit length.
const scale = 1 / (bounds.max.z - bounds.min.z);
bus.traverse(mesh => { if(mesh.isMesh) mesh.geometry.translate(-center.x, -bounds.min.y, -center.z).scale(scale, scale, scale); });
const result = await new GLTFExporter().parseAsync(bus, { binary: true });
writeFileSync(new URL('../public/models/bus.glb', import.meta.url), Buffer.from(result));
console.log(`Prepared bus.glb: ${result.byteLength} bytes`);
