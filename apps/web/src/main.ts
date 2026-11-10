import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { DashboardComponent } from './app/dashboard.component';
import { EditorComponent } from './app/editor.component';
import { ReviewComponent } from './app/review.component';

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideRouter([
    { path: '', component: DashboardComponent },
    { path: 'quotes/:id', component: EditorComponent },
    { path: 'review/:id', component: ReviewComponent },
    { path: 'customer', component: ReviewComponent, data: { customer: true } },
    { path: '**', redirectTo: '' },
  ])],
}).catch((error: unknown) => console.error(error));
