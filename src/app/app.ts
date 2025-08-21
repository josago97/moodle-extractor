import { Component, inject, OnInit, signal } from '@angular/core';
import { MoodleService } from './services/moodle.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly moodle = inject(MoodleService);

  async ngOnInit() {
    const response = await fetch("copia_de_seguridad-moodle-CyR3ESO-30-07-2024-IES-MRE.mbz");
    const blob = await response.blob();

    this.moodle.extract(blob);
  }

  extract() {

  }
}
