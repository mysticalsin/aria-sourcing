declare module "world-atlas/countries-110m.json" {
  const topology: {
    type: "Topology";
    objects: {
      countries: {
        type: "GeometryCollection";
        geometries: Array<{ type: string; id?: string | number; properties?: { name?: string } }>;
      };
    };
    arcs: unknown;
  };
  export default topology;
}
