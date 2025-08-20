import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import * as pako from 'pako';
import { fileTypeFromBuffer } from 'file-type';
import { files } from "browser-stream-tar";

@Injectable({
  providedIn: 'root'
})
export class ExtractorService {

  async extract(moodleFile: any) {
    const response = await fetch("copia_de_seguridad-moodle-CyR3ESO-30-07-2024-IES-MRE.mbz");
    const arrayBuffer = await response.arrayBuffer();
    const mbzArchive = await this.load(arrayBuffer);
    const course = await this.readCourse(mbzArchive);
    const zip = await this.buildZip(course);

    // Crear enlace temporal para descargar
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zip);
    link.download = 'copia.zip';
    link.click();

    // Liberar el objeto URL
    URL.revokeObjectURL(link.href);
  }

  private async readCourse(mbzFile: MbzFolder): Promise<MoodleCourse> {
    const [activities, files, sections] = await Promise.all([
      Promise.resolve(this.readActivities(mbzFile)),
      Promise.resolve(this.readFiles(mbzFile)),
      Promise.resolve(this.readSections(mbzFile))
    ]);

    return { activities, files, sections };
  }

  private readActivities(mbzFile: MbzFolder): MoodleActivity[] {
    const result: MoodleActivity[] = [];
    const activitiesFolders = mbzFile.findFolder('activities')!.getFolders();

    for (const activityFolder of activitiesFolders) {
      const activityTypeName = activityFolder.name.split('_')[0];
      const activityFileName = activityTypeName + '.xml';
      const activityFile = activityFolder.findFile(activityFileName);
      const activityXml = activityFile!.readText();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(activityXml, "text/xml");
      const node = xmlDoc.getElementsByTagName(activityTypeName)[0];
      const type = this.getActivityType(activityTypeName);
      const id = +node.getAttribute('id')!;
      const name = node.getElementsByTagName('name')[0].textContent!;
      const description = node.getElementsByTagName('intro')[0].textContent;
      const files = this.getActivityFiles(activityFolder);

      result.push({
        id: id,
        name: name,
        description: description,
        files: files,
        type: type
      })
    }

    return result;
  }

  private getActivityType(name: string): MoodleActivityType {
    switch (name) {
      case 'assign':
        return MoodleActivityType.Assign
      default:
        return MoodleActivityType.None;
    }
  }

  private getActivityFiles(activityFolder: MbzFolder): number[] {
    const result: number[] = [];
    const infoFile = activityFolder.findFile('inforef.xml')!;
    const infoXml = infoFile.readText()!;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(infoXml, "text/xml");
    const fileNodes = xmlDoc.getElementsByTagName('file');

    for (const fileNode of fileNodes) {
      const id = +xmlDoc.getElementsByTagName('id')[0].textContent!;
      result.push(id);
    }

    return result;
  }

  private readAssign() {

  }

  private readFiles(mbzFile: MbzFolder): MoodleFile[] {
    const result: MoodleFile[] = [];
    const filesXml = mbzFile.findFile('files.xml')!.readText();
    const filesFolder = mbzFile.findFolder('files')!;
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(filesXml, "text/xml");
    const fileNodes = xmlDoc.getElementsByTagName('file');

    for (const fileNode of fileNodes) {
      const filename = fileNode.getElementsByTagName('filename')[0].textContent!;

      if (filename !== '.') {
        const id = +(fileNode.getAttribute('id')!);
        const contenthash = fileNode.getElementsByTagName('contenthash')[0].textContent!;
        const content = filesFolder.findFile(contenthash, true)!.content;

        result.push({
          id: id,
          name: filename,
          content: content
        });
      }
    }

    return result;
  }

  private readSections(mbzFile: MbzFolder): MoodleSection[] {
    const result: MoodleSection[] = [];
    const sectionFiles = mbzFile.findFolder('sections')!
      .getFiles()
      .filter(file => file.name.endsWith('section.xml'));

    for (const sectionFile of sectionFiles) {
      const parser = new DOMParser();
      const sectionXml = sectionFile.readText();
      const xmlDoc = parser.parseFromString(sectionXml, "text/xml");
      const sectionNode = xmlDoc.getElementsByName('section')[0];
      const id = +sectionNode.getAttribute('id')!;
      const number = +sectionNode.getElementsByTagName('number')[0].textContent!;
      const name = sectionNode.getElementsByTagName('name')[0].textContent!;
      const sequence = sectionNode.getElementsByTagName('sequence')[0].textContent!.split(',').map(Number);

      result.push({
        id: id,
        number: number,
        name: name,
        activities: sequence
      })
    }

    return result.sort((s1, s2) => s2.number - s1.number);
  }

  private async load(data: ArrayBuffer): Promise<MbzFolder> {
    const result = new MbzFolder('', null);
    const type = await fileTypeFromBuffer(data);

    switch (type?.ext) {
      case 'zip':
        const zipFile = await JSZip.loadAsync(data);
        for (const entry of Object.values(zipFile.files)) {
          if (!entry.dir) {
            const content = await entry.async("arraybuffer");
            result.addFile(entry.name, content);
          }
        }
        break;

      case 'gz':
        const gzFile = pako.ungzip(data);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(gzFile);
            controller.close();
          }
        });

        for await (const file of files(stream)) {
          const content = await new Response(file.stream()).arrayBuffer();
          result.addFile(file.name, content);
        }
        break;
    }

    return result;
  }

  buildZip(course: MoodleCourse): Promise<Blob> {
    const zip = new JSZip();

    for (let sectionIndex = 0; sectionIndex < course.sections.length; sectionIndex++) {
      const section = course.sections[sectionIndex];
      const folderName = `${sectionIndex + 1}_${section.name}`;
      const sectionFolder = zip.folder(folderName)!;

      for (let activityIndex = 0; activityIndex < section.activities.length; activityIndex++) {
        const activityId = section.activities[activityIndex];
        const activity = course.activities.find(activity => activity.id === activityId)!;
        this.buildActivity(activity, sectionFolder);
      }
    }

    return zip.generateAsync({ type: "blob" });
  }

  private buildActivity(activity: MoodleActivity, sectionFolder: JSZip) {

  }
}

abstract class MbzEntry {
  readonly name: string;
  readonly parent: MbzFolder | null;

  constructor(name: string, parent: MbzFolder | null = null) {
    this.name = name;
    this.parent = parent;
  }
}

class MbzFolder extends MbzEntry {
  private files: MbzFile[];
  private folders: Map<string, MbzFolder>;

  constructor(name: string, parent: MbzFolder | null = null) {
    super(name, parent);
    this.files = [];
    this.folders = new Map<string, MbzFolder>();
  }

  addFile(filename: string, content: ArrayBuffer) {
    const slashIndex = filename.indexOf('/');

    if (slashIndex === -1) {
      this.files.push(new MbzFile(filename, this, content));
    } else {
      const folderName = filename.substring(0, slashIndex);
      const filePath = filename.substring(slashIndex + 1);
      let folder: MbzFolder;

      if (this.folders.has(folderName)) {
        folder = this.folders.get(folderName)!;
      } else {
        folder = new MbzFolder(folderName, this);
        this.folders.set(folderName, folder);
      }

      folder.addFile(filePath, content);
    }
  }

  findFolder(name: string): MbzFolder | undefined {
    return this.folders.get(name);
  }

  findFile(name: string, includeSubFolders: boolean = false): MbzFile | undefined {
    const files = this.getFiles(includeSubFolders);

    return files.find(file => file.name === name);
  }

  getFiles(includeSubFolders: boolean = false): ReadonlyArray<MbzFile> {
    const files = Array.from(this.files);

    if (includeSubFolders) {
      for (const [_, folder] of this.folders) {
        files.push(...folder.getFiles(includeSubFolders));
      }
    }

    return files;
  }

  getFolders(): ReadonlyArray<MbzFolder> {
    return Array.from(this.folders.values());
  }
}

class MbzFile extends MbzEntry {
  readonly content: ArrayBuffer;

  constructor(name: string, folder: MbzFolder, content: ArrayBuffer) {
    super(name, folder);
    this.content = content;
  }

  readText(): string {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(this.content);

    return text;
  }
}

interface MoodleCourse {
  activities: MoodleActivity[];
  files: MoodleFile[];
  sections: MoodleSection[];
}

enum MoodleActivityType {
  None = -1,
  Assign,
  Forum,
  Resource,
  Quiz
}

interface MoodleActivity {
  id: number;
  name: string;
  description: string | null;
  type: MoodleActivityType;
  files: number[];
}

interface MoodleAssign extends MoodleActivity {
  type: MoodleActivityType.Assign;
}

interface MoodleSection {
  id: number;
  number: number;
  name: string;
  activities: number[];
}

interface MoodleFile {
  id: number;
  name: string;
  content: ArrayBuffer;
}
