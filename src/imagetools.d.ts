// Type shims for vite-imagetools query imports.
declare module "*&as=picture" {
  const value: {
    sources: Record<string, string>;
    img: { src: string; w: number; h: number };
  };
  export default value;
}

declare module "*&as=srcset" {
  const value: string;
  export default value;
}

declare module "*&as=metadata" {
  const value: { src: string; w: number; h: number; format: string };
  export default value;
}
