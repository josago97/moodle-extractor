import { Component, inject, OnInit, signal } from '@angular/core';
import { ExtractorService } from './services/extractor.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly extractor = inject(ExtractorService);

  async ngOnInit() {
    const response = await fetch("copia_de_seguridad-moodle-CyR3ESO-30-07-2024-IES-MRE.mbz");
    const blob = await response.blob();

    this.extractor.extract(blob);
  }

  extract() {

  }
}
