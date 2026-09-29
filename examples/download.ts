import { download } from "bun-gis";

const result = await download({
  source: "overture",
  dataset: "buildings",
  bbox: [11.575, 48.137, 11.58, 48.14],
  output: "./buildings.geojson",
  overwrite: true,
});

console.log(result);
