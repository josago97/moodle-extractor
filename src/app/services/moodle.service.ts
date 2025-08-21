import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import * as pako from 'pako';
import { fileTypeFromBuffer } from 'file-type';
import { files } from "browser-stream-tar";

@Injectable({
  providedIn: 'root'
})
export class MoodleService {

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
    URL.revokeObjectURL(link.href);
  }

  private async readCourse(mbzFile: MbzFolder): Promise<MoodleCourse> {
    const [activities, files, sections] = await Promise.all([
      Promise.resolve(this.readActivities(mbzFile)),
      Promise.resolve(this.readFiles(mbzFile)),
      Promise.resolve(this.readSections(mbzFile))
    ]);

    // Eliminar los archivos vacíos de las actividades.
    for (const activity of activities) {
      activity.fileIds = activity.fileIds.filter(fileId => files.some(file => file.id === fileId))
    }

    return { activities, files, sections };
  }

  private readActivities(mbzFile: MbzFolder): MoodleActivity[] {
    const result: MoodleActivity[] = [];
    const activitiesFolders = mbzFile.findFolder('activities')!.getFolders();

    for (const activityFolder of activitiesFolders) {
      const activityNameSplitted = activityFolder.name.split('_');
      const activityTypeName = activityNameSplitted[0];
      const activityFileName = activityTypeName + '.xml';
      const activityId = +activityNameSplitted[1];
      const activityFile = activityFolder.findFile(activityFileName)!;
      const xmlDocument = this.parseXml(activityFile);
      const node = xmlDocument.getElementsByTagName(activityTypeName)[0];
      const type = this.getActivityType(activityTypeName);
      const name = node.getElementsByTagName('name')[0].textContent!;
      const description = this.getActivityText('intro', node);
      const files = this.getActivityFiles(activityFolder);

      result.push({
        id: activityId,
        name: name,
        description: description,
        fileIds: files,
        type: type
      })
    }

    return result;
  }

  private getActivityType(name: string): MoodleActivityType {
    switch (name) {
      case 'assign':
        return MoodleActivityType.Assign;
      case 'label':
        return MoodleActivityType.Label;
      case 'resource':
        return MoodleActivityType.Resource
      default:
        return MoodleActivityType.None;
    }
  }

  private getActivityText(tag: string, node: Element): Text | null {
    const isPlain = !node.getElementsByTagName(`${tag}format`)[0].textContent;
    const content = node.getElementsByTagName(tag)[0].textContent!;

    return content ? { isPlain, content } : null;
  }

  private getActivityFiles(activityFolder: MbzFolder): number[] {
    const result: number[] = [];
    const infoFile = activityFolder.findFile('inforef.xml')!;
    const xmlDocument = this.parseXml(infoFile);
    const fileNodes = xmlDocument.getElementsByTagName('file');

    for (const fileNode of fileNodes) {
      const id = +fileNode.getElementsByTagName('id')[0].textContent!;
      result.push(id);
    }

    return result;
  }

  private readFiles(mbzFolder: MbzFolder): MoodleFile[] {
    const result: MoodleFile[] = [];
    const filesFolder = mbzFolder.findFolder('files')!;
    const filesXml = mbzFolder.findFile('files.xml')!;
    const xmlDocument = this.parseXml(filesXml);
    const fileNodes = xmlDocument.getElementsByTagName('file');

    for (const fileNode of fileNodes) {
      let filename = fileNode.getElementsByTagName('filename')[0].textContent!;

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

  private readSections(mbzFolder: MbzFolder): MoodleSection[] {
    const result: MoodleSection[] = [];
    const sectionFiles = mbzFolder.findFolder('sections')!
      .getFiles(true)
      .filter(file => file.name.endsWith('section.xml'));

    for (const sectionFile of sectionFiles) {
      const xmlDocument = this.parseXml(sectionFile);
      const sectionNode = xmlDocument.getElementsByTagName('section')[0];
      const id = +sectionNode.getAttribute('id')!;
      const number = +sectionNode.getElementsByTagName('number')[0].textContent!;
      const name = sectionNode.getElementsByTagName('name')[0].textContent!;
      const sequence = sectionNode.getElementsByTagName('sequence')[0].textContent!.split(',').map(Number);

      result.push({
        id: id,
        number: number,
        name: name,
        activityIds: sequence
      })
    }

    return result.sort((s1, s2) => s2.number - s1.number);
  }

  private parseXml(file: MbzFile): Document {
    const parser = new DOMParser();
    const xml = file.readText();
    const xmlDocument = parser.parseFromString(xml, "text/xml");

    return xmlDocument;
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

  private buildZip(course: MoodleCourse): Promise<Blob> {
    const zip = new JSZip();

    for (let sectionIndex = 0; sectionIndex < course.sections.length; sectionIndex++) {
      const section = course.sections[sectionIndex];
      const folderName = `${sectionIndex + 1}_${section.name}`;
      const sectionFolder = zip.folder(folderName)!;

      for (let activityIndex = 0; activityIndex < section.activityIds.length; activityIndex++) {
        const activityId = section.activityIds[activityIndex];
        const activity = course.activities.find(activity => activity.id === activityId)!;
        this.buildActivity(activityIndex, activity, sectionFolder, course.files);
      }
    }

    return zip.generateAsync({ type: "blob" });
  }

  private buildActivity(index: number, activity: MoodleActivity, sectionFolder: JSZip, files: MoodleFile[]) {
    const activityName = this.getActivityName(index, activity);
    const hasDescription = Boolean(activity.description);
    const fileCount = activity.fileIds.length;

    if (fileCount == 0) {
      if (hasDescription) {
        this.addActivityText(activityName, activity.description!, sectionFolder);
      } else {
        this.addActivityFile(`${activityName}.txt`, '', sectionFolder);
      }
    } else if (fileCount == 1) {
      const file = files.find(file => file.id === activity.fileIds[0])!;
      const extension = file.name.split('.').pop();
      const filename = `${activityName}.${extension}`;
      this.addActivityFile(filename, file.content, sectionFolder);
    } else {
      const folder = sectionFolder.folder(activityName)!;
      this.addActivityFiles(activity, files, folder);

      if (hasDescription) {
        this.addActivityText(activity.name, activity.description!, folder);
      }
    }
  }

  private getActivityName(index: number, activity: MoodleActivity): string {
    const typeMap: Partial<Record<MoodleActivityType, string>> = {
      [MoodleActivityType.Assign]: 'Tarea',
      [MoodleActivityType.Label]: 'Texto',
    };

    const type = typeMap[activity.type] || '';

    return [index, type, activity.name].filter(Boolean).join('_');
  }

  private addActivityFile(filename: string, content: ArrayBuffer | string, folder: JSZip) {
    // Remove urls.
    console.log(filename)
    filename = filename.replace(/https?:\/\/[^\s]+?\.[a-zA-Z0-9]+/g, '');
    folder.file(filename, content);
  }

  private addActivityText(activityName: string, text: Text, folder: JSZip) {
    const extension = text.isPlain ? 'txt' : 'html';
    const filename = `${activityName}.${extension}`;
    this.addActivityFile(filename, text.content, folder);
  }

  private addActivityFiles(activity: MoodleActivity, files: MoodleFile[], folder: JSZip) {
    for (let i = 0; i < activity.fileIds.length; i++) {
      const fileId = activity.fileIds[i];
      const file = files.find(file => file.id === fileId)!;
      const filename = `${i + 1}_${file.name}`;
      this.addActivityFile(filename, file.content, folder);
    }
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
  Label,
  Resource,
  Quiz
}

interface MoodleActivity {
  id: number;
  name: string;
  description: Text | null;
  type: MoodleActivityType;
  fileIds: number[];
}

interface MoodleAssign extends MoodleActivity {
  type: MoodleActivityType.Assign;
}

interface MoodleSection {
  id: number;
  number: number;
  name: string;
  activityIds: number[];
}

interface MoodleFile {
  id: number;
  name: string;
  content: ArrayBuffer;
}

interface Text {
  isPlain: boolean;
  content: string;
}
