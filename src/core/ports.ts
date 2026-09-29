import type {
  DownloadRequest,
  DownloadResult,
  GeoFeature,
  SourceMetadata,
  WriteResult,
} from "./types";

export interface FeatureSource {
  validateRequest(request: DownloadRequest): void;
  metadata(request: DownloadRequest): Promise<SourceMetadata>;
  download(request: DownloadRequest): AsyncIterable<GeoFeature>;
}

export interface WriterConfig {
  path: string;
  overwrite: boolean;
  metadata: SourceMetadata;
}

export interface GeoWriter {
  write(
    features: AsyncIterable<GeoFeature>,
    config: WriterConfig,
  ): Promise<WriteResult>;
}

export interface Progress {
  phase(label: string): void;
  done(result: DownloadResult): void;
}
