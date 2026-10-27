from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import simpleSplit, ImageReader
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from pathlib import Path
from PIL import Image
P=Path('artifacts/output/T_Bot_Kullanim_Kilavuzu.pdf'); P.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf')); pdfmetrics.registerFont(TTFont('ArialB','C:/Windows/Fonts/arialbd.ttf')); pdfmetrics.registerFont(TTFont('Consolas','C:/Windows/Fonts/consola.ttf'))
c=canvas.Canvas(str(P),pagesize=A4); W,H=A4
ink=HexColor('#172317'); green=HexColor('#42710D'); bright=HexColor('#78B82A'); muted=HexColor('#536358'); bg=HexColor('#F7FAF3'); navy=HexColor('#102A26')
logo='artifacts/build/brand/tabt_logo.png'; screens=Path('artifacts/build/screens')
def page(n,kicker,title,subtitle=''):
 c.setFillColor(bg); c.rect(0,0,W,H,fill=1,stroke=0); c.setFillColor(bright); c.rect(0,H-8,W,8,fill=1,stroke=0)
 c.setFont('ArialB',9); c.setFillColor(green); c.drawString(48,H-45,kicker.upper()); c.setFillColor(ink); c.setFont('ArialB',25); c.drawString(48,H-80,title)
 c.setFillColor(muted); c.setFont('Arial',10); c.drawString(48,H-99,subtitle)
 c.setStrokeColor(HexColor('#DCE8D6')); c.line(48,45,W-48,45); c.setFont('Arial',8); c.setFillColor(muted); c.drawString(48,29,'T BOT  /  KULLANIM KILAVUZU'); c.drawRightString(W-48,29,f'{n:02d}'); return H-133
def text(y,s,size=11,color=ink,indent=0,leading=None):
 leading=leading or size*1.48; c.setFont('Arial',size); c.setFillColor(color)
 for line in simpleSplit(s,'Arial',size,W-96-indent): c.drawString(48+indent,y,line); y-=leading
 return y-7
def head(y,s):
 c.setFillColor(green); c.setFont('ArialB',14); c.drawString(48,y,s); return y-26
def code(y,s):
 lines=s.split('\n'); h=20+len(lines)*16; c.setFillColor(navy); c.roundRect(48,y-h+10,W-96,h,8,fill=1,stroke=0); c.setFont('Consolas',9); c.setFillColor(HexColor('#D7F2DE'))
 for i,line in enumerate(lines): c.drawString(61,y-10-i*16,line)
 return y-h-10
def bullet(y,s): return text(y,'•  '+s,10.5,indent=3)
def shot(y,name):
 h=(W-96)*750/1400; c.drawImage(str(screens/(name+'.png')),48,y-h,width=W-96,height=h,mask='auto'); return y-h-20
def finish(y):
 if y<52: raise ValueError('Page overflow '+str(y))
 c.showPage()
# Cover
c.setFillColor(navy); c.rect(0,0,W,H,fill=1,stroke=0); c.setFillColor(bright); c.rect(0,H-9,W,9,fill=1,stroke=0); c.drawImage(logo,48,H-125,width=158,height=57,mask='auto',preserveAspectRatio=True,anchor='sw'); c.setFillColor(HexColor('#B8E99D')); c.setFont('ArialB',11); c.drawString(50,526,'TERMİNALDE YAPAY ZEKA ASİSTANI'); c.setFillColor(HexColor('#FFFFFF')); c.setFont('ArialB',40); c.drawString(48,460,'T Bot'); c.setFont('ArialB',25); c.drawString(49,420,'Kullanım kılavuzu'); c.setFont('Arial',13); c.setFillColor(HexColor('#D9EBDC')); c.drawString(50,373,'Kurulumdan güvenli günlük kullanıma'); c.setFillColor(bright); c.roundRect(49,135,155,31,15,fill=1,stroke=0); c.setFillColor(navy); c.setFont('ArialB',9); c.drawString(65,146,'TÜRKÇE  /  0.1.0'); c.setFont('Arial',9); c.setFillColor(HexColor('#ADC6B1')); c.drawString(50,76,'Hazırlanan ekranlar temsilidir.'); c.showPage()
y=page(2,'Başlangıç','İçindekiler','İhtiyacınız olan bölüme doğrudan gidin.')
for label,num in [('T Bot nedir?',3),('Kurulum ve güncelleme',4),('İlk açılış ve anahtar',5),('Günlük kullanım ve klavye',6),('Planla, sonra uygula',7),('Hedeflerle çalışma',8),('Alt ajanlarla araştırma',9),('Onaylar ve YOLO',10),('Oturumlar ve devam',11),('Gizlilik ve veri akışı',12),('Sorun giderme',13),('Komut başvurusu',14)]:
 c.setFont('Arial',12); c.setFillColor(ink); c.drawString(50,y,label); c.setFillColor(green); c.drawRightString(W-50,y,f'{num:02d}'); c.setStrokeColor(HexColor('#DDE8D9')); c.line(50,y-8,W-50,y-8); y-=42
finish(y)
y=page(3,'Genel bakış','T Bot nedir?','Yerel terminal arayüzü, seçtiğiniz modelle birlikte çalışır.')
y=text(y,'T Bot, çalışma alanınızı incelemek, görevler üzerinde düşünmek ve izin verilen işlemleri yürütmek için kullanılan bir terminal asistanıdır. Sağlayıcı ve model seçimini siz yaparsınız.')
y=head(y-5,'Bir istek nasıl ilerler?')
for s in ['İsteğinizi terminalde yazın.','Asistan gerektiğinde araç kullanmayı önerir; değişiklik yapabilen işlemler varsayılan olarak onay ister.','Sonuçları okuyun, değişiklikleri gözden geçirin ve sonraki adımı belirtin.']: y=bullet(y,s)
y=head(y-5,'Yapabildikleri')
y=text(y,'Dosyaları inceleyebilir, uygun onayla düzenleyebilir; kabuk ve Git işlemlerinden yararlanabilir. İzole tarayıcı ve Windows masaüstü araçları, uygun yerel ortamın bulunmasına bağlıdır.')
y=head(y,'Yerel arayüz, uzak model')
y=text(y,'Bulut sağlayıcı seçildiğinde konuşma ve ilgili araç sonuçları sağlayıcıya gönderilebilir. Model kullanılabilirliği ve ücretlendirme sağlayıcının hesabına bağlıdır.'); finish(y)
y=page(4,'Kurulum','Kurun ve güncelleyin','Node.js 20.3 veya üzeri, npm, Git ve özel depoya erişim gerekir.')
y=head(y,'Hızlı global kurulum')
y=code(y,'npm install --global git+https://github.com/egemenkrdsek-boop/t-bot.git')
y=text(y,'Git kimlik doğrulamanızı tamamlayın. Aynı komutu tekrar çalıştırmak mevcut sürümü güncellemek için kullanılabilir. npm global komut dizininin PATH üzerinde olması gerekir.')
y=head(y,'Kaynak üzerinden kurulum')
y=code(y,'git clone https://github.com/egemenkrdsek-boop/t-bot.git\ncd t-bot\nnpm ci\nnpm run build\nnpm install --global .')
y=head(y,'Ortamı kontrol edin')
y=code(y,'tbot doctor\ntbot --version')
y=text(y,'Komut bulunamıyorsa terminali yeniden açın; Node, npm, Git ve global npm komut dizini erişimini kontrol edin. Özel depoya erişim için GitHub yetkiniz gerekir.'); finish(y)
y=page(5,'İlk açılış','Sağlayıcı ve model seçimi','Anahtarınızı yalnızca gizli giriş alanına yazın.')
y=shot(y,'setup')
for s in ['tbot komutunu çalıştırın ve sağlayıcıyı menüden seçin.','Gerekiyorsa sağlayıcının API anahtarını girin; giriş maskelenir.','Listeden erişebildiğiniz modeli seçin ve Enter ile onaylayın.','Sağlayıcı veya model değişikliği için tbot config ya da oturumda /config kullanın.']: y=bullet(y,s)
y=text(y,'Menüde ↑ / ↓ seçim, Enter onay ve Esc iptal içindir. Sağlayıcı erişimi ve model listesi hesabınıza göre değişebilir.',10,muted); finish(y)
y=page(6,'Günlük kullanım','İsteğinizi yazın','İnceleme, açıklama ve düzenleme işlerini aynı oturumda yönetin.')
y=code(y,'tbot\ntbot "Bu projeyi incele"\ntbot --workspace C:\\projeler\\ornek')
y=head(y,'Kısa bir iş akışı')
for s in ['Hedefi ve ilgili dosyaları açıkça belirtin.','Asistanın yanıtını ve önerdiği araç işlemlerini okuyun.','İstenen onaya y veya yes ile yanıt verin; sonucu gözden geçirin.']: y=bullet(y,s)
y=head(y,'Terminal kısayolları')
y=text(y,'Ctrl+C çalışan işlemi iptal eder; boşta çıkış yapar. Satır sonundaki ters eğik çizgiyle çok satırlı giriş oluşturabilirsiniz. /help oturum içi komutları listeler; /exit veya /quit çıkar.')
y=head(y,'Çalışma alanı')
y=text(y,'--workspace veya -w ile başlangıç dizinini belirleyin. Kabuk, kullanıcı hesabınızın yetkileriyle çalışma alanı dışına da erişebilir; onay ekranındaki işlemi inceleyin.'); finish(y)
y=page(7,'Planlama','Önce plan, sonra uygulama','Planı gözden geçirip açıkça uygulamayı başlatın.')
y=shot(y,'plan')
y=code(y,'/plan İstediğiniz değişikliği açıklayın\n/plan apply')
y=text(y,'İlk komut araç kullanmadan bir plan oluşturur. /plan apply, aynı uygulama oturumunda bellekte bekleyen planı uygular. Uygulama aşamasında normal araç onayları geçerlidir.')
y=text(y,'Planı güncellemek için yeni bir /plan isteği yazın. /clear konuşmayı ve bekleyen planı temizler.',10,muted); finish(y)
y=page(8,'Hedefler','Bir hedefi yönetin','Hedef durumunu görün; tamamlamayı açıkça belirtin.')
y=code(y,'/goal Projenin belgelerini iyileştir\n/goal status\n/goal run\n/goal pause\n/goal resume\n/goal complete\n/goal cancel')
y=text(y,'/goal <hedef> bir hedef oluşturur ve sınırlı çalıştırır. status mevcut durumu gösterir; run çalıştırır; pause ve resume akışı duraklatır ve sürdürür. complete tamamlamayı, cancel iptali belirtir. /goal done, complete ile eş anlamlıdır.')
y=head(y,'Nerede saklanır?')
y=text(y,'Hedef bilgisi çalışma alanındaki .tbot/goal.json dosyasında tutulur. Hedefi tamamlamadan önce çıktıyı gözden geçirin; uygulama hedefi kendi başına tamamlanmış saymaz.'); finish(y)
y=page(9,'Araştırma','Alt ajanları kullanın','Bağımsız araştırmaları ana ajan bir araya getirir.')
y=shot(y,'subagents')
y=code(y,'/subagents Kodun test yapısını incele\n/subagents')
y=text(y,'Komut alt ajan modeli seçtirir; istek verilirse araştırma başlatır. Argümansız kullanımda geçerli seçimi koruma, değiştirme veya kapatma seçenekleri sunulur.')
y=text(y,'En fazla üç bağımsız, salt okunur araştırma yürütülür; eşzamanlılık ikidir. Ana ajan bulguları değerlendirir ve gerekli işi yapar.',10,muted); finish(y)
y=page(10,'Onaylar','YOLO oturum modu','Varsayılan olarak kapalıdır.')
y=shot(y,'yolo')
y=code(y,'/yolo on\n/yolo off\ntbot --yolo')
y=text(y,'Normal modda değişiklik yapabilen belirli araç işlemleri için onay istenir. /yolo on veya --yolo bu oturumdaki araç onaylarını otomatik verir; /yolo off normal onay akışını geri getirir.')
y=text(y,'Otomatik onay, komutların kullanıcı hesabınızın yetkileriyle çalışabileceği anlamına gelir. Yalnızca işlemleri gözden geçirebildiğiniz ve güvendiğiniz oturumlarda kullanın.',10,muted); finish(y)
y=page(11,'Oturumlar','Kaydedin ve devam edin','Oturum kimliği ile önceki konuşmaya dönün.')
y=code(y,'tbot sessions\ntbot --resume OTURUM_KIMLIGI\ntbot -r OTURUM_KIMLIGI')
y=text(y,'tbot sessions kayıtlı oturumları listeler. Oturum içindeki /sessions geçerli kimliği gösterir. /resume ise CLI üzerinden devam etmeniz için yönlendirir.')
y=head(y,'Oturum içi işlemler')
for s in ['/clear konuşma bağlamını ve bekleyen planı temizler.','/exit veya /quit ile oturumdan çıkın.','Bir sonraki açılışta kimliği --resume ile verin.']: y=bullet(y,s)
y=text(y,'Oturumlar ve ayarlar Windows üzerinde %APPDATA%/TBot altında, APPDATA yoksa ~/.config/TBot altında tutulur. Bu konumdaki dosyaları kendi erişim politikalarınıza göre koruyun.',10,muted); finish(y)
y=page(12,'Gizlilik','Veri ve anahtarlar','Seçtiğiniz sağlayıcının veri işleme ve fiyatlandırma koşullarını inceleyin.')
for title,body in [('Model isteği','Konuşma, ilgili dosyalar, araç çıktıları ve tarayıcı veya masaüstü ekran görüntüleri seçilen model sağlayıcısına gönderilebilir. Hassas içerik içeren görevlerde bunu göz önünde bulundurun.'),('Anahtar saklama','Windows üzerinde anahtar DPAPI ile şifrelenir; şifreleme veya dizin güvenliği sağlanamazsa kayıt durur. Diğer platformlarda erişimi kısıtlı, şifresiz dosya kullanılabilir.'),('Anahtar önceliği','Sağlayıcı için kayıtlı anahtar, sağlayıcıya özgü ortam değişkeninden; o da TBOT_API_KEY değişkeninden önce kullanılır.'),('Yerel modeller','Ollama veya LM Studio seçildiğinde ilgili yerel sunucu ve model çalışır durumda olmalıdır. Araçlar ayrıca ağ erişimi kullanabilir.')]:
 y=head(y,title); y=text(y,body)
finish(y)
y=page(13,'Destek','Sorun giderme','Önce güvenli kontrol, sonra yeniden deneyin.')
for title,body in [('401 / yetkilendirme','/auth ile geçerli sağlayıcının yeni anahtarını girin; sağlayıcı hesabının model erişimini kontrol edin. Başarısız istek otomatik tekrarlanmaz; anahtarı güncelledikten sonra yeniden gönderin.'),('Anahtar saklama hatası','tbot doctor ile ortamı kontrol edin. Windows kullanıcı profilinin ve PowerShell erişiminin çalıştığını doğrulayın; terminalde gösterilen aşama bilgisini destek için kullanın.'),('Geçersiz adres veya bağlantı','tbot config ile sağlayıcıyı yeniden seçin. Yerel sağlayıcı için sunucunun çalıştığını, adresin geçerli olduğunu kontrol edin.'),('Komut veya model bulunamadı','Node, npm, Git ve PATH ayarlarını kontrol edin. tbot providers ve tbot doctor çıktılarından yararlanın; model erişimi sağlayıcı hesabınıza bağlıdır.')]:
 y=head(y,title); y=text(y,body,10.5)
finish(y)
y=page(14,'Başvuru','Komutlar bir arada','En sık kullanılan CLI ve oturum içi komutlar.')
y=head(y,'Terminal')
for s in ['tbot  •  tbot "istek"  •  tbot config','tbot providers  •  tbot sessions  •  tbot doctor','--provider / -p  •  --model / -m  •  --workspace / -w','--resume / -r  •  --yolo  •  --help / -h  •  --version / -v']: y=bullet(y,s)
y=head(y,'Oturum içinde')
for s in ['/help  •  /config  •  /provider  •  /model  •  /auth','/plan <istek>  •  /plan apply  •  /subagents [istek]','/goal <hedef>  •  /goal status|run|pause|resume|complete|cancel','/yolo [on|off]  •  /sessions  •  /resume  •  /clear  •  /exit  •  /quit']: y=bullet(y,s)
y=head(y,'Destek için hazırlayın')
y=text(y,'tbot --version ve tbot doctor çıktısını gözden geçirin. Paylaşmadan önce anahtarları, özel dosya yollarını ve hassas içerikleri çıkarın. Kod deposuna erişim ve sağlayıcı hesabı konularında ilgili yöneticinizle görüşün.'); finish(y)
c.save(); print('PDF created')
