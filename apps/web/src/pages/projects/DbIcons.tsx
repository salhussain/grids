import { siJavascript, siPython, siR, siClickhouse, siGooglebigquery, siGooglecloudstorage, siGoogledrive, siMariadb, siMysql, siPostgresql, siSnowflake } from 'simple-icons';
import { Cloud, Database, Link2, Table2, Upload } from 'lucide-react';

type Icon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/** A product's own mark, drawn in its colour. */
const brand = (i: { path: string; hex: string; title: string }): Icon =>
  function BrandIcon({ className }) {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={i.title} className={className} fill={`#${i.hex}`}>
        <path d={i.path} />
      </svg>
    );
  };

/** The generic database mark, in a product's colour, for the ones with no mark we can use. */
const tinted = (color: string, Glyph: Icon = Database): Icon =>
  function TintedIcon({ className }) {
    return <Glyph className={className} style={{ color }} />;
  };

/** The icon for each kind of database. */
export const BRAND_ICON = {
  postgres: brand(siPostgresql),
  mysql: brand(siMysql),
  mariadb: brand(siMariadb),
  clickhouse: brand(siClickhouse),
  snowflake: brand(siSnowflake),
  bigquery: brand(siGooglebigquery),
  // Their marks are not in the open icon set, so these keep the generic database icon in each product's colour.
  redshift: tinted('#8C4FFF'),
  mssql: tinted('#CC2927'),
  oracle: tinted('#C74634'),
  // Where a file lives.
  file: tinted('#52525b', Link2),
  gcs: brand(siGooglecloudstorage),
  gdrive: brand(siGoogledrive),
  s3: tinted('#569A31', Cloud),
  azure_blob: tinted('#0078D4', Cloud),
} as const;

/** The icon for what a dataset is made from: a database, SQL over other sources, code, or uploaded rows. */
export const DATASET_ICON = {
  sql: tinted('#0f766e', Table2),
  python: brand(siPython),
  r: brand(siR),
  javascript: brand(siJavascript),
  rows: tinted('#71717a', Upload),
} as const;
