import type { AgentInput, Message, Provider } from './types.js';
export type UltracodeInput = AgentInput & {
    workerProvider: Provider;
    session?: any;
};
export interface UltracodeOptions {
    session?: any;
}
/**
 * 4 Aşamalı Öz-Onarımlı (Self-Healing) Ultracode Mühendislik Hattı:
 * 1. Uzman Alt Ajan Araştırması ve Uygulama
 * 2. Bağımsız Kalite ve Güvenlik Denetimi
 * 3. Otonom Öz-Onarım ve Doğrulama
 * 4. Son İnceleme ve Mühendislik Özeti Hazırlanıyor
 */
export declare function runUltracode(input: UltracodeInput, options?: UltracodeOptions): Promise<Message[]>;
