![T Bot logosu](assets/tabit.webp)

# T Bot

T Bot, terminalden çalışan, farklı model sağlayıcılarıyla kullanılabilen yerel bir TypeScript ajanıdır. Etkileşimli oturumlarda veya tek bir istekle çalışır; modele bağlı olarak dosyalar, kabuk, Git, tarayıcı ve Windows masaüstü araçlarını kullanabilir.

## Gereksinimler ve kurulum

Node.js 20.3 veya üzeri, npm ve Git gerekir. Özel GitHub deposuna erişim yetkisi olan bir hesapla Git kimlik doğrulamasını yapılandırın. Son `main` sürümünü global yüklemek için:

```powershell
npm install --global git+https://github.com/egemenkrdsek-boop/t-bot.git
```

Kurulum, `prepare` aşamasında projeyi derler. Global kurulumdan sonra `tbot` komutu kullanılabilir; güncellemek için aynı komutu tekrar çalıştırın. Kaynak kodundan kurulum için [kurulum rehberine](docs/install.md) bakın.

## Sağlayıcı ayarları

İlk açılışta seçili sağlayıcının anahtarı yoksa etkileşimli kurulum sağlayıcı, model ve gizli anahtar girişini açar. Terminal dışındaki kullanımda eksik anahtar için ilgili ortam değişkeni veya `tbot config` yönergesi gösterilir.

Etkileşimli terminalde `tbot config` çalıştırın; sağlayıcı ve modeli ok tuşları ve Enter ile menüden seçin, gerektiğinde yalnızca API anahtarını yazın. Model listesi sağlayıcıdan alınır; erişilemezse yerleşik seçenekler gösterilir. Öncelikli sağlayıcılar Google Gemini (`gemini`), OpenAI (`openai`), Anthropic (`anthropic`) ve OpenRouter (`openrouter`) olarak listelenir. Diğer seçenekler dahil tüm sağlayıcıları `tbot providers` gösterir. Varsayılan OpenAI ve `gpt-4o-mini` modelidir. Erişim ve özellik desteği seçtiğiniz sağlayıcıya ve modele bağlıdır.

Kaydedilen API anahtarları sağlayıcı kimliğine göre ayrı tutulur. `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ve `OPENROUTER_API_KEY` ortam değişkenleri de kullanılabilir; kayıtlı anahtar bulunmadığında kullanılır. Genel `TBOT_API_KEY`, kayıtlı ve sağlayıcıya özgü anahtarlar yoksa ortak yedektir. Windows'ta yeni anahtarlar kullanıcıya bağlı DPAPI ile şifrelenir; dizin koruması veya şifreleme başarısızsa kayıt hata verir. Diğer platformlarda anahtar erişimi kısıtlanmış bir dosyada şifrelenmeden saklanır ve uygulama uyarı verir.

Ollama ve LM Studio seçenekleri yerel çalışan bir sunucu ve yüklenmiş model gerektirir. Çevrimdışı model kullanımı için bunları yerel uç noktaya yönlendirin; T Bot tek başına bir model içermez. Özel uç noktalar HTTPS veya localhost üzerinde HTTP kullanmalıdır.

401 kimlik doğrulama hatasında sağlayıcı hesabınızın erişimini kontrol edin ve gerekirse yeni anahtarı T Bot içinde `/auth` ile girin. Önceki istek otomatik tekrar edilmez. OpenRouter için yeni anahtar kaydedilmeden önce sağlayıcının anahtar uç noktasında doğrulanır; doğrulama başarısızsa önceki anahtar korunur.

## Kullanım

```text
tbot                              Etkileşimli oturum
tbot "isteğiniz"                  Tek seferlik istek
tbot -p <sağlayıcı> -m <model>    Bu oturum için seçim
tbot -w <dizin>                   Çalışma dizini seçimi
tbot sessions                     Kayıtlı oturumları listele
tbot --resume <id>                Oturuma devam et
tbot config                       Sağlayıcı ayarları
tbot providers                    Sağlayıcıları listele
tbot doctor                       Ortam ve ayar durumunu göster
tbot --effort <düzey>            İstek için akıl yürütme düzeyi
tbot --ultracode                 Bu oturumda Ultracode modunu aç
tbot --yolo                      Bu oturumda araç onaylarını otomatik ver
tbot --help                       Yardım
tbot --version                    Sürüm
```

Etkileşimli modda `/help`, `/clear`, `/provider`, `/model`, `/sessions`, `/config`, `/resume` ve `/exit` veya `/quit` kullanılabilir. `/provider`, `/model` ve `/config` seçim menüsünü açar; `/resume` terminal komutuna yönlendirir. Çok satırlı giriş için satırı `\` ile bitirin. Ctrl+C geçerli işlemi iptal eder.

- `/goal <hedef>` hedefi kaydedip sınırlı bir çalışma başlatır. `/goal status`, `/goal run`, `/goal pause`, `/goal resume`, `/goal complete` ve `/goal cancel` ile durumunu yönetin. Tamamlanma açıkça işaretlenir; çalışma otomatik olarak sonsuza kadar sürmez.
- `/plan <istek>` araç kullanmadan bir plan oluşturur. Geçerli oturumda bu planı inceleyip `/plan apply` ile uygulamayı başlatabilirsiniz; araç onayları ayrıca geçerlidir.
- `/subagents` alt ajan modelini seçer veya açıkken değiştirme ve kapatma menüsünü gösterir. `/subagents <istek>` seçilen modelle paralel salt okunur araştırma başlatır; uygulamayı ana ajan yapar. Açıkken sonraki normal isteklerde de alt ajanlar kullanılabilir.

Etkileşimli oturumda `/yolo` menüsünden veya `/yolo on` ve `/yolo off` komutlarıyla araç onaylarının otomatik verilmesini seçebilirsiniz. `--yolo` modu başlangıçta açar. Ayar yalnızca geçerli oturumda geçerlidir; varsayılan olarak onay istenir. YOLO açıkken kabuk komutları ve diğer onay gerektiren araçlar kullanıcı yetkileriyle otomatik çalışabilir. Plan uygulaması yine `/plan apply` ile başlatılır; salt okunur alt ajan sınırları korunur.

## Çalışma düzeyi ve beceriler

`/effort` menüsünden veya `/effort low`, `medium`, `high`, `xhigh`, `max` komutlarından birini seçin. Varsayılan `medium` düzeyidir; seçim sağlayıcı ve model çiftine göre kaydedilir. `--effort <düzey>` başlangıçta seçim yapar. Sağlayıcı ve modelin sunduğu seçeneklere göre değer eşlenebilir veya sağlayıcının varsayılanı kullanılabilir; alt ajan modeli kendi sağlayıcı/model düzeyini kullanır; her modelin beş düzeyi yerel olarak desteklediği varsayılmamalıdır.

`/ultracode on` ve `/ultracode off` ile isteğe bağlı Ultracode modunu yönetin; `--ultracode` oturum başında açar. Varsayılan kapalıdır. Mod sınırlı paralel araştırmanın ardından ana ajanla uygulama ve bağımsız salt okunur inceleme yapar. İnceleme bulgularının kendiliğinden düzeltildiği varsayılmamalıdır.

`/skills` yerleşik becerileri listeler; `/skills <id>` bir becerinin ayrıntılarını gösterir. `/frontenddesign <istek>`, `/backend <istek>`, `/codereview <istek>`, `/debuganalysis <istek>` ve `/imagegen <istek>` ile doğrudan kullanabilirsiniz; eşleşen Türkçe veya İngilizce ifadeler de uygun beceriyi seçebilir. Frontend becerisi mevcut projeye uygun, erişilebilir ve duyarlı gerçek arayüz kodu üretmeyi hedefler. Kod inceleme ve hata analizi komutları salt okunurdur; doğal dilde analizle birlikte açık bir düzeltme isteği verilirse uygulama düzeltmeye izin verebilir.

`/imagegen` yapılandırılmış OpenAI, Gemini veya OpenRouter anahtarlarından ve görüntü modeli menüsünden seçim sunar. Anthropic için yerel görsel üretimi bulunmaz; görsel üretmek için desteklenen başka bir sağlayıcının anahtarı gerekir. Hesabınızda seçilen görüntü modeline erişim gerekir; oluşturulan görseller çalışma alanındaki `generated-images/` dizinine kaydedilir. İstek ücret doğurabilir ve normalde onay gerektirir; YOLO açıkken onay otomatik verilir.

## MCP bağlantıları

Etkileşimli oturumda `/mcp` menüsünden Vercel, Supabase veya GitHub bağlantısını kurabilir, yenileyebilir veya yerel kaydını kaldırabilirsiniz. Token girişi maskelenir ve tokenlar API anahtarlarıyla aynı saklama mekanizmasını kullanır. Sağlayıcı tokenını ve hesap yetkilerini kullanıcı sağlar; yerel kaydı kaldırmak tokenı sağlayıcıda iptal etmez. Kullanılabilir işlemler hesap, token ve servis yetkilerine bağlıdır.

- **Vercel:** T Bot'un yerel MCP adaptörü Vercel API tokenıyla `list_projects`, `get_project`, `list_deployments`, `create_project` ve `create_deployment` araçlarını sunar. Dağıtım için açıkça bir GitHub depo kimliği ve ref veya dosyalar sağlanır. Varsayılan dağıtım önizlemedir; üretim hedefi açıkça seçilir. Dağıtım yanıtı derlemenin devam ettiğini gösterebilir. Adaptör, Vercel'in resmi hosted OAuth MCP sunucusu değildir.
- **Supabase:** Resmi uzak Supabase MCP sunucusuna kişisel erişim tokenı (PAT) ile bağlanır. Hesap yetkileri dahilinde proje oluşturma ve Edge Function dağıtma dahil sunucunun sunduğu araçlar kullanılabilir. Edge Function dağıtımı frontend barındırma anlamına gelmez.
- **GitHub:** Resmi uzak GitHub MCP sunucusuna kişisel erişim tokenıyla bağlanır. Sunulan araçlar ve yazma işlemleri seçili araçlar ile token ve depo izinlerine bağlıdır.

Her MCP araç çağrısı onay ister; YOLO açıksa onay otomatik verilir. Alt ajanların salt okunur araç listesine MCP araçları dahil edilmez. Bu özellikler için gerçek servis bağlantısı veya dağıtım testi yapılmadı.

## Terminal görünümü

Etkileşimli başlangıçta logo ve piksel bot gösterilir; uygun terminalde kısa bir başlangıç animasyonu oynatılır. `TBOT_NO_ANIMATION` ortam değişkenini tanımlamak statik görünümü seçer. `NO_COLOR` renkleri kapatır ve piksel görünümü tek renkli olur.

## Araçlar ve gizlilik

Ajan dosya okuma ve değiştirme, kabuk komutu, Git işlemleri, izole tarayıcı ve Windows masaüstü kontrolü araçlarını sunar. Değişiklik yapabilen işlemler için varsayılan olarak onay istenir. Kabuk komutları kullanıcının yetkileriyle çalışır ve çalışma dizini dışına erişebilir. Terminal olmadan onay gerektiren işlemler reddedilir.

Tarayıcı araçları paketle gelen `playwright-core` ve uyumlu kurulu Chrome veya Chromium gerektirir; mevcut kişisel tarayıcı profilini kullanmaz. Masaüstü kontrolü yalnızca etkileşimli Windows masaüstünde çalışır ve PowerShell gerektirir. Ekran görüntüleri yerel dosyalara kaydedilebilir.

Ayarlar, anahtarlar ve oturumlar Windows'ta `%APPDATA%\TBot`, diğer ortamlarda `~/.config/TBot` altında tutulur. Bulut sağlayıcısı seçildiğinde konuşma ve modele sunulan araç sonuçları ilgili sağlayıcıya gönderilir; dosya içerikleri, komut çıktıları ve tarayıcı veya masaüstü ekran görüntülerinin pikselleri de bu sonuçlara dahil olabilir. Yerel bir sağlayıcı seçmek, model isteklerinin seçilen yerel sunucuya gitmesini sağlar; tarayıcı ve kabuk gibi araçlar ayrıca ağ erişimi yapabilir.

## Lisans

Proje [MIT lisanslıdır](LICENSE). Köken, üçüncü taraf bildirimleri ve dağıtım konuları için [hukuki notlara](docs/legal.md) ve [üçüncü taraf bildirimlerine](THIRD_PARTY_NOTICES.md) bakın.
