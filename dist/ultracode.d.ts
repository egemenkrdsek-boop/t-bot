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
 * 1. Araştırma (Research): Salt-okunur alt ajanlarla kanıt toplama.
 * 2. Uygulama (Implementation): Ana ajanla kodlama ve değişiklikleri uygulama.
 * 3. Bağımsız Denetim (Review): Salt-okunur denetçi ajanla değişiklikleri inceleme ([ONAYLANDI] / [ONARIM_GEREKLI]).
 * 4. Otonom Öz-Onarım (Self-Healing Pass): Denetçi onarım gerektirirse ana ajanın hataları kendi kendine düzeltmesi.
 */
export declare function runUltracode(input: UltracodeInput, options?: UltracodeOptions): Promise<Message[]>;
