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

## 2.0 çekirdek doğrulaması

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

## 2.1.0 — OpenCode'dan gerçek, sınırları belirtilmiş edit uyarlaması

`src/tools/edit-match.ts`, OpenCode'un **fa1260d6ca484fe0fd868aa992ad81ab85343cf3** commitindeki [packages/core/src/tool/plugin/edit.ts](https://github.com/anomalyco/opencode/blob/fa1260d6ca484fe0fd868aa992ad81ab85343cf3/packages/core/src/tool/plugin/edit.ts) saf eşleştirme/offset/satır sonu algoritmalarından uyarlanmıştır. Kaynak blob **5165e7a5547b94c638d847da9d16f5066bb481b1**; [pinned lisans](https://github.com/anomalyco/opencode/blob/fa1260d6ca484fe0fd868aa992ad81ab85343cf3/LICENSE) MIT, Copyright (c) 2025 opencode. `normalizeForMatch`, occurrence/line occurrence taraması, LF görünümünü kaynak konumuna taşıma, dominant ending, LCS satır hizalama ve bölge satır sonlarını geri kurma mantığı gerçek kaynak uyarlamasıdır. Modül headerı ve dağıtım notices'ı atıf taşır. Bu, bütün upstream geçmişinin birleştirildiği ya da OpenCode'un tüm özelliklerinin taşındığı iddiası değildir.

Eşleştirme sırası: exact LF-view; eşleşme yoksa bire bir UTF-16 uzunluğu koruyan tipografik Unicode normalizasyonu; yine yoksa satır sonu boşluk toleransı. İlk başarılı tier kendi içinde benzersiz olmalıdır. Daha düşük tier'de başka olası eşleşme bulunması exact tier'in tek açık hedefini geçersiz kılmaz. Değişiklik özgün kaynaktaki span'e uygulanır; karışık LF/CRLF dosyanın diğer bölgeleri yeniden normalize edilmez. Sadece carriage return farkı isteyen açık satır sonu değişiklikleri exact byte mantığıyla uygulanır.

Upstream'den kasıtlı farklar:

- `replaceAll`, Effect, formatter ve harici dizin yetkileri taşınmadı; mevcut T Bot onay/containment/grounding/AST katmanları korunur. Overlapping tekrarlar da belirsiz sayılır.
- Tolerant eşleşmede değişmeyen context satırları ve satır içi karakterleri gerçek kaynaktan tutulur. Örneğin modelin `"a-b"; n=1` → `"a-b"; n=2` isteği gerçek kaynakta `"a—b"` varsa yalnız `n` değerini değiştirir. Gerçek kaynak metniyle verilen exact edit, açık Unicode normalizasyon değişikliğini uygulayabilir. Eşleme güvenle yapılamıyorsa yeniden tam kaynak okuma/daha küçük patch istenir.
- Kaynak/old/new için 1 milyon karakter, her hunk'ın bütün satır/karakter LCS işlemlerine ortak 1 milyon hücre, line fallback için 20 bin satır ve 1 milyon karşılaştırma sınırı vardır. Batch en çok 32 hunk ve toplam 1 milyon old/new karakteridir. CRLF konumları tek taramada tutulur; match-array spread kullanılmaz, line fallback kayıtları sınırdan önce durur. Büyük ama açık exact edit için bütün dosyaya satır fallback sınırı uygulanmaz.

Aynı pinned committe [FileMutation](https://github.com/anomalyco/opencode/blob/fa1260d6ca484fe0fd868aa992ad81ab85343cf3/packages/core/src/file-mutation.ts), blob **53d53e42fde3d97b95f5a9cc2a240872c83d1dd3**, süreçler arası değil süreç içinde bütün read/prepare/write işlemini kilitleyen keyed mutex kullanır. O snapshot'ta `FileTime/assertTime` API'si saptanmadı; eski sürümdeki adı bugünkü upstream'e atfetmiyoruz. T Bot bu transaction sınırını küçük yerel Promise mutex ile uygular; Effect runtime'ı eklemez. Lock-map girdileri son bekleyen işlem release olduğunda silinir; başarısızlık da kilidi bırakır.

T Bot'a özgü tazelik kontrolleri: tam kaynak okunmuşsa SHA-256 hash, bütün okumalar için dev/inode/size/mtimeNs/ctimeNs revision tutulur. Mutation mevcut içerik ve revision'ı önceki inspection ile karşılaştırır; aynı boyut ve geri alınmış mtime bu hash kontrolünü geçmez. Offset/partial okumalar tam kaynak hash'i üretmediğinden metadata revision kullanır. Kendi başarılı yazması sabit readback ile sonraki yama için yeni snapshot kaydeder. `file_write` da artık `atomicWrite`'a beklenen mevcut içeriği verir. Her Windows rename retry'sı expected content ve güvenli yolu yeniden denetler; atomik rename başarısızsa copy-overwrite fallback yapılmaz. Yeni dosya yayınlama aynı dizindeki tamamlanmış temp dosyasını `link(temp,target)` ile atomik no-clobber olarak yapar; arada oluşturulmuş hedef `EEXIST` verir, desteklenmeyen dosya sisteminde sessiz overwrite yapılmaz.

Mevcut dosya mutasyonları geçersiz UTF-8/NUL içeriği round-trip byte kontrolüyle reddeder; BOM korunur. Yeni içerikte lone surrogate/NUL de yazmadan reddedilir. Korunan kaynak baytları sözleşmesi valid UTF-8 text içindir; binary veya UTF-16 düzenleme desteği yoktur. Snapshot, kilit ve içerik kontrolü sıradan eşzamanlı kullanıcı düzenlemelerinde veri kaybını önler; dış süreçle son compare→rename arasında atomik OS CAS garantisi, reparse-point sandbox'ı veya kötü niyetli eşzamanlı filesystem aktörüne karşı mutlak güvenlik iddiası yoktur. Bağlamdan evicted inspection izinlerini otomatik silme bu portun kapsamında değildir; kesin kaynak gerektiğinde yeniden okuma ve exact hedef eşleştirme hâlâ gereklidir.

Yeni doğrulama: `node --import tsx --test tests/edit-match.test.ts` **13/13 geçti**. Unicode exact önceliği/ambiguity, aynı satır Unicode literal context'i, trailing whitespace, mixed endings, outside-span/BOM byte korunması, explicit newline edit, LCS/line/input/batch limitleri, 400 bin CRLF'li exact kaynak, stale same-size/mtime, doğrudan hash fixture, concurrent cooperating patch, no-clobber creation, retry sırasında dış edit ve failure sonrası lock release kapsanır. `tests/runtime-tools.test.ts` değiştirilmedi. E2E/live provider/build/kurulum/commit/push yapılmadı; konsolide typecheck ve tam test suite ana orkestratörün işidir.

## Sonraki retrieval incelemesi — derin depolarda dosya ve sembol kapsamı

Önceki uygulama kökten alfabetik ilk 80 kaynak dosyada yürümeyi durduruyordu. 85 küçük kök dosyası ve `packages/deep/.../reset-password.ts` fixture'ında hedef hiç görünmedi; tek dosyanın 16. sembolü de sabit ilk-10 summary sınırının dışında kaldı. Cache yalnız mtime'a bakıyor, workspace-relative hazır metni absolute dosya anahtarıyla paylaşıyordu. Bu nedenle kaynak değişikliği ve aynı dosyayı alt-workspace üzerinden gösterme hatalı sonuç verebiliyordu. `agent.ts` üstündeki ikinci 45 saniyelik cache de builder'ın dosya güncellemelerini görmesini engelliyordu.

Yeni akış: sınırlı dizin envanteri → deterministik dosya adı sıralaması → seçilmiş dosyalarda bütçeli kaynak/AST incelemesi → sorguyla eşleşen sembolleri önce gösteren token sınırlı harita. `rankRepoPaths(paths, query, limit)` salt bellek üzerinde çalışır. Unicode, camelCase ve underscore terimleri kullanılır; açık dosya adı eşleşmesi genel path parçalarından güçlüdür. Bir dosyanın geç sembolü cache hazır summary'si yerine sorguya göre yeniden sıralanır. Class arrow-function alanları da method sembolü olarak kaydedilir. `.mts`, `.cts`, `.markdown` parser destekleri envanterde artık düşmez.

Java/C/C++/C#/Swift/Kotlin/Ruby/PHP/Shell/Vue/SQL ve yaygın config/metin uzantıları, ayrıca sorguda açıkça geçen diğer dosya adları, **yalnız dosya adı kanıtı** olarak listelenebilir. Desteklenmeyen dile TypeScript AST'si uygulanmaz; `not inspected` işareti kullanılır. Açık `types.d.ts` sorgusu ilgili declaration dosyasını da getirebilir. Bu, bütün dillerde grammar/AST veya global sembol arama desteği iddiası değildir.

Kök ve iç `.gitignore` dosyalarının yaygın glob kuralları (anchor, negation, `*`, `?`, `**`, karakter sınıfı, escape) uygulanır; statik generated/vendor dizin engelleri korunur. Global Git ayarları veya workspace dışı exclude dosyaları okunmaz. Tam Git ignore parser eşdeğerliği iddia edilmez; güvenle okunamayan/limit aşan ignore dosyasında ilgili dizin taranmaz. Adversarial glob'lar regex backtracking yerine ortak bütçeli DP ile eşleştirilir. Mevcut symlink/junction girişleri atlanır; parser açmadan önce canonical path/lstat doğrulanır. Bunlar kötü niyetli eşzamanlı filesystem değişimine karşı atomik sandbox değildir.

Sınırlar:

- En çok 10.000 directory entry ve 512 dizin; envantere yaklaşık 100 ms, kaynak incelemeleri dahil yaklaşık 250 ms kooperatif süre hedefi. Tek TypeScript parse işlemi veya OS çağrısı bu hedefi aşabilir; sert gerçek zaman garantisi yoktur.
- En çok 80 seçilmiş dosya incelenir; parser dosyası 512 KiB ile ve file-descriptor üzerinden sınırlı okumayla korunur. Dosya adı görülmüş fakat içerik incelenmemişse bu açıkça belirtilir.
- Her ignore dosyası 32 KiB/512 kural, inherited toplam 1024 kural, pattern 256 karakter ve bütün envanter için 2 milyon DP hücresi. Limitte harita kapsama uyarısı verir; “eşleşme yok” veya “tüm depo incelendi” iddia etmez.
- Cache en çok 128 dosya, toplam 8192 sembol ve 256 Ki karakter sembol adı tutar; AST/source nesnesi tutulmaz. dev/inode/size/mtimeNs/ctimeNs revision her builder çağrısında doğrulanır. Gösterim workspace-relative ve query-specific olarak yeniden kurulur. 2.0 bölümünde anlatılan üst 64-workspace/45s cache kaldırılmıştır.

Harita **partial** bir excerpt'tır. Dosya adıyla ilişkisi olmayan bir sembol, dosyası 80 parse adayı arasına giremezse hâlâ görünmeyebilir; çok büyük/derin depoların tamamı için recall garantisi yoktur. `file_glob`/`file_search` ve cerrahi `file_read` ile tamamlanmalıdır. Harita okunmuş dosya yetkisi oluşturmaz; mevcut grounding/snapshot/onay kontrolleri değişmedi. Ajan turu başladıktan sonraki dosya düzenlemelerinde harita snapshot'ı yerine güncel kaynak okunmalıdır.

Doğrulama: `node --import tsx --test tests/repo-map.test.ts` **10/10**, `tests/repo-map.test.ts tests/core.test.ts` birlikte **37/37 geçti** (son koşu yaklaşık 2,81 s). Derin monorepo hedefi, geç sembol, query değişimi, restored mtime/same-size cache tazeliği, alt-workspace relative path, silinen dosya, ignore/negation/glob, symlink/junction, oversized source, Unicode/uzantı/class-field kapsamı ve parser desteklenmeyen dosyaların dürüst filename-only gösterimi kapsanır. E2E, canlı model/ağ, build, kurulum, commit/push veya sürüm yükseltmesi yapılmadı.

Offline fixture ölçümü (yerel Windows/Node, tek süreç; gerçek sağlayıcı tokenları değil): 10.000 sentetik path üzerinde hedef **top-1**; bir ısınma ve 10 ölçümde medyan **10,874 ms**, min **9,981 ms**, max **12,467 ms**. GC sonrası süreç RSS **162,49 MiB**, heap **34,77 MiB**; ölçüm öncesine göre retained heap farkı **−6,09 KiB** (ölçüm gürültüsü, RAM tasarrufu veya leak yokluğu kanıtı değildir; peak RAM ölçülmedi). 85 kök kaynak + bir derin 21 satırlık hedef fixture'ında dosya ve `resetPassword[L21-21]` görünür; harita **174 tahmini token / 292 karakter**, tüm fixture kaynakları **1382 tahmini token**, harita üretimi **87,902 ms**. Bu bir hedef bulma/excerpt boyutu ölçümüdür; sonraki kaynak okuma dahil bütün görev maliyeti, model kalitesi veya rakip üstünlüğü sonucu çıkarılmaz.

Ölçümü yeniden üretmek için proje kökünde PowerShell:

```powershell
@'
import { performance } from 'node:perf_hooks';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankRepoPaths, buildWorkspaceRepoMap } from './src/repo-map.ts';
import { estimateTokens } from './src/token-optimizer.ts';
const paths=Array.from({length:9999},(_,i)=>`packages/pkg${i}/src/unrelated${i}.ts`);
paths.push('apps/account/src/reset-password.ts');
rankRepoPaths(paths,'resetPassword reset-password',8); global.gc?.();
const before=process.memoryUsage(), times=[]; let first='';
for(let i=0;i<10;i++) {
  const start=performance.now(); first=rankRepoPaths(paths,'resetPassword reset-password',8)[0];
  times.push(performance.now()-start);
}
global.gc?.(); const after=process.memoryUsage(); times.sort((a,b)=>a-b);
const root=await mkdtemp(join(tmpdir(),'tbot-map-measure-'));
try {
  const sources=Array.from({length:85},(_,i)=>`export const unrelated${i}=1;`);
  await Promise.all(sources.map((source,i)=>writeFile(join(root,`a${String(i).padStart(3,'0')}.ts`),source)));
  const deep=join(root,'packages/deep/auth/src'); await mkdir(deep,{recursive:true});
  const source=Array.from({length:20},(_,i)=>`export const helper${i}=1;`).join('\n')+'\nexport function resetPassword() {}';
  await writeFile(join(deep,'reset-password.mts'),source); sources.push(source);
  const start=performance.now(), map=await buildWorkspaceRepoMap(root,'resetPassword reset-password',180);
  console.log({ top1:first, medianMs:(times[4]+times[5])/2, minMs:times[0], maxMs:times.at(-1),
    rssMiB:after.rss/1048576, heapUsedMiB:after.heapUsed/1048576,
    retainedHeapDeltaKiB:(after.heapUsed-before.heapUsed)/1024,
    targetFile:map.includes('reset-password.mts'), targetSymbol:map.includes('resetPassword[L21-21]'),
    mapEstimatedTokens:estimateTokens(map), allSourceEstimatedTokens:sources.reduce((n,s)=>n+estimateTokens(s),0),
    mapMs:performance.now()-start, mapChars:map.length });
} finally { await rm(root,{recursive:true,force:true}); }
'@ | node --expose-gc --import tsx --input-type=module -
```
