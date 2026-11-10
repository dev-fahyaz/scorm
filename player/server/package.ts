import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { XMLParser } from "fast-xml-parser";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export const ZIP_BOMB = {
  maxRatio: 100,
  minCheckedBytes: 10 * 1024 * 1024,
};

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageError";
  }
}

export type CourseItem = {
  id: string;
  title: string;
  href: string;
};

export type ParsedPackage = {
  title: string;
  version: "1.2" | "2004";
  items: CourseItem[];
  warnings: string[];
};

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

export function assertSafeEntry(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "" || hasControlCharacter(normalized)) {
    throw new PackageError(`The package contains an unsafe path: ${name}`);
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new PackageError(`The package contains an absolute path: ${name}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === ".")) {
    throw new PackageError(`The package contains a path that escapes the archive: ${name}`);
  }
  return normalized;
}

type ZipEntries = {
  zip: ZipFile;
  files: Map<string, Entry>;
};

function zipError(error: unknown): PackageError {
  if (error instanceof PackageError) return error;
  if (error && typeof error === "object" && "code" in error && error.code === "ENOSPC") {
    return new PackageError("The server ran out of disk space while unpacking the package.");
  }
  const message = error instanceof Error ? error.message : "";
  if (/absolute path/i.test(message)) {
    return new PackageError(`The package contains an absolute path: ${message.split(": ").pop()}`);
  }
  if (/invalid relative path/i.test(message)) {
    return new PackageError(
      `The package contains a path that escapes the archive: ${message.split(": ").pop()}`,
    );
  }
  if (/invalid characters/i.test(message)) {
    return new PackageError("The package contains an unsafe path.");
  }
  return new PackageError("The file is not a valid ZIP package.");
}

export async function openZip(zipPath: string): Promise<ZipEntries> {
  let zip: ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, { lazyEntries: true, autoClose: false });
  } catch (error) {
    throw zipError(error);
  }

  const files = new Map<string, Entry>();
  try {
    for await (const entry of zip.eachEntry()) {
      const name = assertSafeEntry(entry.fileName);
      if (name.endsWith("/")) continue;
      if (entry.isEncrypted()) {
        throw new PackageError(`The package contains an encrypted file: ${name}`);
      }
      if (
        entry.uncompressedSize > ZIP_BOMB.minCheckedBytes &&
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > ZIP_BOMB.maxRatio
      ) {
        throw new PackageError("The package looks like a ZIP bomb and was rejected.");
      }
      files.set(name, entry);
    }
  } catch (error) {
    zip.close();
    throw zipError(error);
  }
  return { zip, files };
}

async function readText(zip: ZipFile, entry: Entry): Promise<string> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

function destinationFor(root: string, name: string): string {
  const base = path.resolve(root);
  const destination = path.resolve(base, ...name.split("/"));
  if (destination !== base && !destination.startsWith(base + path.sep)) {
    throw new PackageError(`The package contains an unsafe path: ${name}`);
  }
  return destination;
}

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  if (Array.isArray(value))
    return value.filter((item) => item && typeof item === "object") as XmlNode[];
  if (typeof value === "object") return [value as XmlNode];
  return [];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) {
    return textOf((value as XmlNode)["#text"]);
  }
  return "";
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function findFile(names: string[], href: string): string | null {
  const path = href.split(/[?#]/)[0] ?? "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  const normalized = decoded.replace(/\\/g, "/").replace(/^\.\//, "");
  if (names.includes(normalized)) return normalized;
  const lower = normalized.toLowerCase();
  return names.find((name) => name.toLowerCase() === lower) ?? null;
}

function detectVersion(
  schemaVersion: string,
  rawXml: string,
): { version: "1.2" | "2004"; warning?: string } {
  const value = schemaVersion.toLowerCase();
  if (value.includes("1.2")) return { version: "1.2" };
  if (value.includes("2004") || value.includes("1.3") || /\bcam\b/.test(value))
    return { version: "2004" };
  if (/adlcp_rootv1p3|imscp_v1p1|adlseq_|adlnav_/i.test(rawXml)) return { version: "2004" };
  if (/imscp_rootv1p1p2|adlcp_rootv1p2/i.test(rawXml)) return { version: "1.2" };
  return {
    version: "1.2",
    warning: schemaVersion
      ? `Unrecognised SCORM version "${schemaVersion}". The player will launch it as SCORM 1.2.`
      : "The manifest does not declare a SCORM version. The player will launch it as SCORM 1.2.",
  };
}

export function parseManifest(rawXml: string, fileNames: string[]): ParsedPackage {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    processEntities: false,
    isArray: (name) => ["organization", "item", "resource", "file"].includes(name),
  });

  let document: XmlNode;
  try {
    document = parser.parse(rawXml.replace(/^\uFEFF/, "")) as XmlNode;
  } catch {
    throw new PackageError("imsmanifest.xml could not be parsed.");
  }

  const manifest = document.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new PackageError("imsmanifest.xml has no manifest element.");
  }
  const root = manifest as XmlNode;
  const metadata = (root.metadata ?? {}) as XmlNode;
  const detected = detectVersion(textOf(metadata.schemaversion), rawXml);
  const warnings: string[] = [];
  if (detected.warning) warnings.push(detected.warning);

  const organizations = asArray((root.organizations as XmlNode | undefined)?.organization);
  const defaultOrg = textOf((root.organizations as XmlNode | undefined)?.["@_default"]);
  const organization =
    organizations.find((org) => textOf(org["@_identifier"]) === defaultOrg) ?? organizations[0];
  if (!organization) {
    throw new PackageError("The manifest has no organization.");
  }

  const resources = new Map<string, XmlNode>();
  for (const resource of asArray((root.resources as XmlNode | undefined)?.resource)) {
    const id = textOf(resource["@_identifier"]);
    if (id) resources.set(id, resource);
  }

  const items: CourseItem[] = [];
  let sequencing = false;
  const visit = (nodes: unknown) => {
    for (const item of asArray(nodes)) {
      if ("sequencing" in item) sequencing = true;
      const ref = textOf(item["@_identifierref"]);
      const title = decodeXml(textOf(item.title) || "Untitled");
      const id = textOf(item["@_identifier"]) || `item-${items.length + 1}`;
      if (ref) {
        const resource = resources.get(ref);
        const href = textOf(resource?.["@_href"]);
        if (!resource || !href) {
          warnings.push(`"${title}" points at resource "${ref}", which has no launch file.`);
        } else if (!findFile(fileNames, href)) {
          warnings.push(`The launch file for "${title}" is missing: ${href}`);
        } else {
          items.push({ id, title, href });
        }
      }
      if (item.item) visit(item.item);
    }
  };
  visit(organization.item);

  if (sequencing) {
    warnings.push(
      "This package includes sequencing. Items launch directly, without sequencing rules.",
    );
  }

  for (const resource of resources.values()) {
    for (const file of asArray(resource.file)) {
      const href = textOf(file["@_href"]);
      if (href && !findFile(fileNames, href)) {
        warnings.push(`Missing file referenced by the manifest: ${href}`);
      }
    }
  }

  if (items.length === 0) {
    throw new PackageError("The manifest has no launchable SCO.");
  }

  const title = decodeXml(textOf(organization.title) || items[0]?.title || "Untitled course");
  return {
    title,
    version: detected.version,
    items,
    warnings: [...new Set(warnings)].slice(0, 20),
  };
}

export async function extractPackage(zipPath: string, destination: string): Promise<ParsedPackage> {
  const { zip, files } = await openZip(zipPath);
  try {
    const manifestName =
      [...files.keys()].find((name) => name.toLowerCase() === "imsmanifest.xml") ?? null;
    if (!manifestName) {
      throw new PackageError("The package has no imsmanifest.xml at the ZIP root.");
    }
    const xml = await readText(zip, files.get(manifestName)!);
    const parsed = parseManifest(xml, [...files.keys()]);

    const createdDirs = new Set<string>();
    for (const [name, entry] of files) {
      const target = destinationFor(destination, name);
      const dir = path.dirname(target);
      if (!createdDirs.has(dir)) {
        await mkdir(dir, { recursive: true });
        createdDirs.add(dir);
      }
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, createWriteStream(target));
    }
    return parsed;
  } catch (error) {
    throw zipError(error);
  } finally {
    zip.close();
  }
}
