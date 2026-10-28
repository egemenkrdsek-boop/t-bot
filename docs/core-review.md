# Çekirdek inceleme — 28 Ekim 2026

Deniz: ajan döngüsü, sağlayıcı adaptörleri, token optimizasyonu, diferansiyel okuma, repo haritası, grounding, kalıcı bellek/oturum, kaynak koruması ve iş akışı katmanları incelendi. Çalışma yerel doğruluk ve ölçülebilir bileşen davranışlarına odaklandı. E2E ve canlı sağlayıcı çağrısı yapılmadı; commit/push yapılmadı.

## Doğrulanmış hatalar ve kararlar

| Bulgu | Değişiklik / kanıt |
| --- | --- |
| Bilinmeyen kısa istemler sohbet sayılıp araçlar ve beceriler kaldırılıyordu. `refactor authentication`, `devam et`, `deploy` gibi istekler etkileniyordu. | Hız yolu yalnız tam eşleşen sosyal ifadeleri kabul eder; aktif becerilerde devre dışıdır. Çok dilli/eylem/devam istemleri regresyon testiyle korunur. |
| Bütçe sonu sentez yanıtı alınamayınca çekirdek kendiliğinden “görev tamamlandı” metni üretiyordu. | Eksik nihai yanıt açıkça belirtilir, tamamlanma doğrulanmış sayılmaz. Sentez yanıtına da karakter sınırı uygulandı. |
| Bağımsız denetçi başarısız olsa da Ultracode özet talimatı `[ONAYLANDI]` diyordu. | Denetim bulunmadığında özet bu eksikliği belirtir; başarısız onarım sonrası başarı özeti yapılmaz. Sahte sağlayıcılı bileşen testi geçti. Alt ajan hata sonrası kısmi metinleri kısmi rapor olarak işaretler. |
| Unicode büyük/küçük harfi olmayan alfabeler token sayımından tamamen düşebiliyordu. | Genel Unicode harf alternatifi eklendi; Çince/Japonca/Arapça/Hintçe girdilerde sıfır olmayan ve metinle büyüyen tahmin testi geçti. Bu bir kesin tokenizer değildir. |
| Yapışkan araç niyetleri süreç genelinde diğer konuşmalardan sızıyordu. | Her `runAgent` çağrısı kendi niyet kümesini kullanır; tur içinde kararlılık sürer, geçmiş gerçek araç çağrıları tekrar etkinleştirmeyi sağlar. Eski dış API varsayılanı korunur. |
| Diferansiyel diff boş taraflarda ve ayrı ekleme bloklarında hatalı başlangıç koordinatları veriyordu. | Eski/yeni satır imleçleri tek geçişte hesaplanır; boş taraflar unified diff kurallarına uyar. Ayrı ekleme/silme regresyonları geçti. |
| Büyük dosyanın kısa kesiti tekrar okununca kaynak metinden pahalı cache referansı üretilebiliyordu. Diff başlık tokenları tasarruf hesabına katılmıyordu. | Yalnız pozitif gerçek çıktı tasarrufunda referans üretilir; diff başlığı ve dosya yolu hesaba katılır. Kaynak bağlamdan sıkışıp çıkarılırsa cache kapsamı düşürülmeye devam eder. |
| `.tbot` junction/symlink ile memory/goal/todo yazmaları workspace dışına yönlenebiliyordu. | Ortak `workspaceStatePath` helperı mevcut ancestor/final linkleri reddeder. Memory backup/lock, proje kuralları, goal ve todo yollarında kullanılır. Windows junction fixture dış hedefin değişmediğini doğrular. Bu ön kontrol yarış halindeki başka bir sürece karşı atomik OS sandbox değildir. |
| Todo dosyası doğrudan yazılıyor, disk hataları yutuluyor ve eşzamanlı eklemeler kaybolabiliyordu. | Atomik geçici dosya + rename; hatalar çağırana aktarılır. Todo tool read/modify/write işlemi dosya kilidiyle korunur; 6 eşzamanlı add kayıpsız doğrulandı. |
| Custom/local model keşfi yapılandırılmış uç noktayı kullanmıyordu. | Opsiyonel `baseUrl` yalnız custom/ollama/lmstudio için kullanılır. HTTPS veya localhost HTTP, kullanıcı bilgisi/query/hash reddi, redirect engeli; mock testi resmi sağlayıcı anahtarının override sunucuya gönderilmediğini doğrular. |
| Üst seviye repo haritası cache'i workspace sayısıyla sınırsız büyüyordu. | En çok 64 workspace girdisi tutulur; dosya haritasının mevcut 256 girdilik/512 KiB dosya sınırları korunur. |

`ImageAttachment` PNG yanında gerçekten desteklenen JPEG türünü de taşır; screenshot yolunda tür zorlaması kaldırıldı. Modelin çakışan araç kimlikleri ürettiği durumda otomatik kimlik tahsisi de eski ve aynı tur kimliklerini birlikte kontrol eder.

## Doğrulama

Komut: `node --import tsx --test tests/core.test.ts tests/providers.test.ts`

Son çalıştırma: **35/35 geçti**, 0 başarısız, yaklaşık 2,67 saniye. Bunlar sahte sağlayıcı akışları, yerel geçici dosyalar, cache/token birimleri ve iş akışı bileşenleridir. E2E değildir. Meşru workspace symlink alias'ının canonical sonucunu yeniden doğrulama da test edilir; workspace içindeki dışarı yönlenen link yine reddedilir. Tam suite/build/typecheck ana orkestratörün kaynak sırasına bırakıldı. Önceden var olan `tests/runtime-tools.test.ts` değişikliğine dokunulmadı.

## Sınırlı offline ölçüm

Tek süreç, Windows yerel Node.js, 200 sıcak-cache yinelemesi. 48 gerçek araç şeması + 300 satırlık sentetik TypeScript okuma fixture'ı; ağ/model/tarayıcı/terminal aracı çalıştırılmaz. Sonuçlar **uygulamanın token tahmincisine** göredir; faturalandırılmış token, model kalitesi veya rakip karşılaştırması değildir.

| Ölçüm | Sonuç |
| --- | --- |
| `refactor parser` için tam → budanmış şema | 48 → 19 araç; 13.812 → 5.770 tahmini token (**%58,2**) |
| 12.571 karakterlik / 300 satırlık kaynağın hemen tekrar okunması | 7.500 → 89 tahmini token (**%98,8**); referans 161 karakter |
| Şema budama + ilk/tekrar cache okuması, 200 yineleme | 11,94 ms toplam; 0,060 ms/yineleme |
| İçe aktarılan çekirdek dahil işlem snapshot'ı, kontrollü GC sonrası | RSS 168,49 MiB; heapUsed 38,83 MiB; ölçüm öncesine göre heap farkı +82,89 KiB |

Tablo aşağıdaki doküman komutunun dosyadan birebir çıkarılıp tekrar yürütülmesiyle güncellendi; fixture gerçek newline ile 300 satır ve 12.571 karakterdir. RAM snapshot'ı bellek tasarrufu iddiası değildir; JIT, GC, başlangıç importları ve ortam sonucu etkiler. Ölçüm cold start'ı, ağ gecikmesini, canlı sağlayıcı tokenizasyonunu, çok turlu kaliteyi veya uzun oturum bellek büyümesini kapsamaz. Cache referansı yalnız önceki kaynak gerçekten görünür bağlamdaysa güvenlidir; uygulama sıkıştırma sonrası kapsamı kontrol eder. Bu fixture sonuçları evrensel **%50–75 daha az token** veya **dünya #1** iddiasını desteklemez.

Yeniden üretmek için proje kökünde PowerShell:

```powershell
@'
import { performance } from 'node:perf_hooks';
import { getToolDefinitions } from './src/tools/index.ts';
import { WORKFLOW_TOOLS } from './src/workflows.ts';
import { estimateMessagesTokens, estimateTokens, pruneToolDefinitions } from './src/token-optimizer.ts';
import { ContextReadCache } from './src/context-cache.ts';
const tools = [...getToolDefinitions(), ...WORKFLOW_TOOLS];
const source = Array.from({length: 300}, (_, i) => `${i+1}: export const item${i} = "fixture-${i}";`).join('\n');
const baseline = estimateMessagesTokens([], undefined, tools);
const optimized = pruneToolDefinitions(tools, 'refactor parser', [], [], new Set());
const cache = new ContextReadCache();
cache.checkAndRecordRead('fixture', 'src/example.ts', source, 1, 300, source);
const repeat = cache.checkAndRecordRead('fixture', 'src/example.ts', source, 1, 300, source);
global.gc?.();
const before = process.memoryUsage();
const start = performance.now();
for (let i = 0; i < 200; i++) {
  pruneToolDefinitions(tools, 'refactor parser', [], [], new Set());
  const reads = new ContextReadCache();
  reads.checkAndRecordRead('fixture', 'src/example.ts', source, 1, 300, source);
  reads.checkAndRecordRead('fixture', 'src/example.ts', source, 1, 300, source);
}
const elapsedMs = performance.now() - start;
global.gc?.();
const after = process.memoryUsage();
console.log({ tools: tools.length, kept: optimized.tools.length,
  schemaTokens: [baseline, estimateMessagesTokens([], undefined, optimized.tools)],
  readTokens: [estimateTokens(source), estimateTokens(repeat.output)],
  sourceChars: source.length, referenceChars: repeat.output.length,
  elapsedMs, msPerIteration: elapsedMs/200,
  rssMiB: after.rss/1048576, heapUsedMiB: after.heapUsed/1048576,
  retainedHeapDeltaKiB: (after.heapUsed-before.heapUsed)/1024 });
'@ | node --expose-gc --import tsx --input-type=module -
```

## Kalan sınırlar

Grounding denetimi metin iddialarına dayalı yardımcı kontroldür; mutlak “sıfır halüsinasyon” garantisi sağlamaz. Repo map zaman/dosya sınırı nedeniyle tüm depoyu temsil etmeyebilir; cerrahi okuma için başlangıç kanıtıdır. Sağlayıcı effort/model tabloları statiktir ve canlı yetenek garantisi değildir. Oturumlar sıradan kimlik bilgilerini redakte eder, bütün olası sırları tanıdığı iddia edilmez. Canlı model/browser/computer kalitesi, dış servis uyumluluğu ve uzun koşu bellek davranışı bu birim/bileşen testlerinden çıkarılamaz.

Önceki çekirdek incelemesinin geçerli sınırları da korunur: 28.000 token geçmiş hedefi son kullanıcı turunu bütün tuttuğundan o tur tek başına büyükse sert üst sınır değildir. Sıkıştırma kayıplıdır; tam kaynak gerektiren değişiklikte yeniden okuma gerekir. Dil doğrulayıcıları derleyici eşdeğeri değildir. `process_output` üzerinden sonradan tamamlanan arka plan işi henüz grounding defterinde özgün komutuyla otomatik ilişkilendirilmez. Legacy UI tanıları en son ana ajan defterini gösterir; eşzamanlı ana ajanların birleşik audit kaydı değildir.

Mevcut `AsyncLocalStorage` grounding/okuma/export izolasyonu, native Responses çağrı uzlaştırması, salt-okunur politika denetimi, bellek işlem kilitleri ve kritik RAM koruması korunmuştur. Bunları kapsayan önceki regresyonlar da yukarıdaki 35 testin içindedir. Kabuk gerçek kullanıcı yetkileriyle çalışır; araç onayları, prompt talimatları ve kooperatif dosya kilitleri işletim sistemi güvenlik sınırı oluşturmaz.
