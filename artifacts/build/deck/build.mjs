import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const root = 'C:/Users/Egemen/Desktop/T Bot';
const build = path.join(root,'artifacts/build/deck');
const out = path.join(root,'artifacts/build/validated/T_Bot_Yonetim_Kurulu_validated_v4.pptx');
const skill = 'C:/Users/Egemen/.codex/plugins/cache/openai-primary-runtime/presentations/26.1020.11348/skills/presentations';
const py = 'C:/Users/Egemen/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
await fs.mkdir(build,{recursive:true}); await fs.mkdir(path.dirname(out),{recursive:true});
const deck=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#F7FAF3',dark:'#172317',green:'#42710D',lime:'#78B82A',muted:'#526454',line:'#C5D3BA',white:'#FFFFFF',deep:'#14231F'};
const img = async file => {let b=await fs.readFile(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const logo=await img(path.join(root,'artifacts/build/brand/tabt_logo.png'));
const screenshots={}; for(const name of ['setup','plan','subagents','yolo']) screenshots[name]=await img(path.join(root,`artifacts/build/screens/${name}.png`));
function box(slide,x,y,w,h,fill=C.bg,stroke='none',name='shape') {return slide.shapes.add({name,geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{style:'solid',fill:stroke,width:stroke==='none'?0:1}})}
function text(slide,value,x,y,w,h,size=25,color=C.dark,bold=false,opts={}) {const s=slide.shapes.add({name:opts.name||'editable-text',geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{style:'solid',fill:'none',width:0}});s.text=value;s.text.style={typeface:'Arial',fontSize:size,color,bold,alignment:opts.align||'left',verticalAlignment:opts.valign||'top',wrap:'square',autoFit:'none',insets:0};return s}
function image(slide,bytes,x,y,w,h,alt){slide.images.add({blob:bytes,contentType:'image/png',alt,fit:'contain',position:{left:x,top:y,width:w,height:h}})}
function note(slide,body,src){slide.speakerNotes.text=`${body}\n\nKaynak: ${src}`}
function base(title,index,kicker='YÖNETİM KURULU') {const s=deck.slides.add();s.background.fill=C.bg; text(s,kicker,65,38,650,24,16,C.green,true); text(s,title,65,88,1145,94,44,C.dark,true); box(s,65,185,1150,2,C.line);text(s,String(index).padStart(2,'0'),1160,668,50,24,16,C.muted,true,{align:'right'});return s}
function bodyLine(s,label,copy,y){text(s,label,72,y,280,36,26,C.green,true);text(s,copy,360,y,815,66,25,C.dark)}
function darkBand(s,words,sub){box(s,65,545,1150,76,C.deep);text(s,words,90,563,330,38,26,C.white,true);text(s,sub,420,565,760,35,22,'#D8E7D1')}
function point(s,num,title,body,y){text(s,num,73,y,80,55,38,C.lime,true);text(s,title,167,y,335,38,26,C.dark,true);text(s,body,510,y+1,650,57,23,C.dark)}
// 1 cover
{
 const s=deck.slides.add();s.background.fill=C.deep; image(s,logo,72,52,188,68,'Orijinal tabit logosu');
 text(s,'T Bot',72,210,1040,100,74,C.white,true);text(s,'Yönetim kurulu değerlendirmesi',75,320,990,54,34,'#DCEBD8');
 box(s,75,409,145,5,C.lime);text(s,'Yerel çalışma ortamı için yapay zekâ ajanı',75,452,940,48,26,'#DCEBD8');
 note(s,'Sunum ürünün mevcut kaynak koduna dayanır. Önerilen pilot ve yol haritası karar seçenekleridir.','package.json; README.md; src/app.ts');
}
// 2
{
 const s=base('Yönetim özeti',2);text(s,'T Bot, çalışma alanındaki işleri terminalden yöneten bir yapay zekâ ajanıdır.',75,224,1100,90,31,C.dark,true);
 point(s,'01','Tek çalışma ortamı','Dosya, kabuk ve tarayıcı araçları tek akışta kullanılabilir.',357);
 point(s,'02','Seçilebilir model','Kullanıcı sağlayıcı ve modeli seçer. Erişim kendi hesabına bağlıdır.',434);
 darkBand(s,'Karar önerisi','Sınırlı kapsamlı bir pilotun koşullarını belirleyin.');
 note(s,'Yerel uygulama olarak çalışır; bulut sağlayıcı seçildiğinde modele veri gönderilir. Pilot bir öneridir, onaylanmış program değildir.','README.md; src/tools/index.ts; src/providers.ts');
}
//3
{
 const s=base('Ele alınan çalışma sorunu',3);text(s,'Tek bir istek, birden fazla araç ve karar gerektirebilir.',70,223,1100,57,30,C.dark,true);
 bodyLine(s,'Parçalı süreç','Dosyaları inceleme, değişiklik ve kontrol farklı adımlara dağılır.',328);
 bodyLine(s,'Bağlam geçişi','İnsan, model ve çalışma alanı arasında bilgi tekrar aktarılır.',412);
 bodyLine(s,'Kontrol ihtiyacı','Değişiklikler için yetki ve kullanıcı onayı görünür olmalıdır.',496);
 note(s,'Bu slayt ürünün hedeflediği iş akışı sorununu anlatır; ölçülmüş zaman kaybı veya kurumsal performans iddiası değildir.','src/agent.ts; src/tools/index.ts');
}
//4
{
 const s=base('Ürün kapsamı',4);text(s,'Terminalden çalışan ajan, kullanıcının isteğini araçlarla ilerletir.',72,221,1120,80,30,C.dark,true);
 point(s,'01','Çalışma alanı','Dosya okuma, arama ve kontrollü değişiklik.',344);
 point(s,'02','İş akışı','Kabuk, Git durumu ve izole tarayıcı araçları.',425);
 point(s,'03','Masaüstü','Etkileşimli Windows masaüstü desteği.',506);
 note(s,'Git araçları durum, fark ve geçmiş okumayı kapsar. Tarayıcı uyumlu kurulu Chrome veya Chromium gerektirir. Masaüstü kontrolü yalnızca Windows içindir.','src/tools/index.ts; src/tools/git.ts; src/tools/browser.ts; src/tools/computer.ts');
}
//5 diagram
{
 const s=base('Yerel mimari ve veri akışı',5);text(s,'Uygulama yerelde çalışır. Model çağrıları ilgili sağlayıcıya gider.',70,218,1100,58,28,C.dark,true);
 const nodes=[{x:75,y:325,title:'Kullanıcı',sub:'İstek ve onay'},{x:465,y:325,title:'T Bot',sub:'Ajan ve oturum'},{x:855,y:325,title:'Sağlayıcı',sub:'Model yanıtı'},{x:465,y:490,title:'Araçlar',sub:'Yerel çalışma alanı'}];
 for(const n of nodes){box(s,n.x,n.y,275,105,'#E6EFDF',C.line);text(s,n.title,n.x+17,n.y+13,240,35,25,C.green,true);text(s,n.sub,n.x+17,n.y+59,240,36,21,C.dark)}
 text(s,'↔',365,347,74,55,42,C.green,true,{align:'center'});text(s,'↔',755,347,74,55,42,C.green,true,{align:'center'});text(s,'↕',562,430,80,58,42,C.green,true,{align:'center'});
 text(s,'Konuşma ve seçilen araç sonuçları T Bot üzerinden sağlayıcıya gider.',75,631,1080,34,22,C.muted);
 note(s,'Şema mantıksal akış içindir. T Bot araç sonuçlarını modele iletebilir. Kabuk kullanıcı yetkileriyle çalışma alanı dışına da erişebilir.','src/agent.ts; src/providers.ts; src/tools/shell.ts');
}
//6
{
 const s=base('Sağlayıcı ve model seçimi',6);text(s,'Kullanıcı kendi sağlayıcısını, modelini ve anahtarını seçer.',70,220,1100,58,29,C.dark,true);
 const list=[['Google Gemini','Google hesabı ve seçilen model'],['OpenAI','OpenAI hesabı ve seçilen model'],['Anthropic','Anthropic hesabı ve seçilen model'],['OpenRouter','Erişilen model ve sağlayıcı koşulları']];
 let yy=318;for(const [a,b] of list){text(s,a,80,yy,300,38,26,C.green,true);text(s,b,410,yy,700,38,24,C.dark);box(s,80,yy+52,1040,1,C.line);yy+=67}
 note(s,'Bu liste öncelikli dört sağlayıcıyı gösterir; ek ve yerel seçenekler de bulunur. Model erişimi ve araç desteği modele ve hesaba bağlıdır; ortaklık veya tüm modeller için uyumluluk iddiası yoktur.','src/providers.ts; src/models.ts');
}
//7 screen
{
 const s=base('Başlangıç ve kurulum',7);text(s,'Sağlayıcı ve model menüden seçilir. API anahtarı gizli girilir.',70,215,1100,60,28,C.dark,true);image(s,screenshots.setup,70,293,800,340,'Temsili kurulum ekranı'); text(s,'Temsili ekran',72,641,250,25,18,C.muted,true);
 text(s,'Kullanıcı akışı',900,315,285,36,25,C.green,true);text(s,'Seçim menüsü\n\nGizli anahtar girişi\n\nKaydedilmiş ayarlar',900,365,270,200,23,C.dark);
 note(s,'Görsel temsilîdir, gerçek çalışma zamanı ekran kaydı değildir. OpenRouter için yeni anahtar kaydedilmeden önce anahtar uç noktasında doğrulanır.','src/app.ts; src/menu.ts; src/providers.ts');
}
//8 screenshot
{
 const s=base('Plan ve kontrollü uygulama',8);text(s,'Plan önce oluşturulur, uygulama ayrı bir kullanıcı komutuyla başlar.',70,217,1110,62,28,C.dark,true);image(s,screenshots.plan,70,296,830,340,'Temsili plan ekranı'); text(s,'Temsili ekran',72,641,250,25,18,C.muted,true);
 text(s,'Plan',925,310,260,34,25,C.green,true);text(s,'Araç kullanılmadan öneri üretilir.',925,353,255,76,23,C.dark);text(s,'Uygulama',925,452,260,34,25,C.green,true);text(s,'/plan apply ile aynı oturumda başlar.',925,495,255,88,23,C.dark);
 note(s,'Planlama aşamasında sağlayıcıya araç tanımları verilmez. Bekleyen plan uygulama oturumunda bellektedir; uygulama adımında normal araç onayları geçerlidir.','src/workflows.ts; src/app.ts');
}
//9
{
 const s=base('Hedefler ve alt ajanlar',9);text(s,'Uzun işler, hedef kaydı ve sınırlı araştırma adımlarıyla yönetilir.',70,218,1120,65,28,C.dark,true);
 box(s,72,320,500,238,'#E6EFDF');text(s,'Hedef',100,348,400,40,29,C.green,true);text(s,'Durum kaydedilir. Çalışma sınırlı bir tur olarak yürür. Tamamlanmayı kullanıcı işaretler.',100,405,410,120,24,C.dark);
 box(s,650,320,500,238,'#EDF3E9');text(s,'Alt ajanlar',678,348,400,40,29,C.green,true);text(s,'Seçilen modelle en fazla üç salt okunur araştırma yapılır. Sonuçları ana ajan değerlendirir.',678,405,410,120,24,C.dark);
 text(s,'Eşzamanlı çalışan araştırma sınırı: iki',75,592,1040,35,22,C.muted);
 note(s,'Alt ajanlar bağımsız bağlamlarda araştırma yapar, değişiklikleri ana ajan üstlenir. /goal durum, duraklatma ve devam komutları sunar.','src/subagents.ts; src/workflows.ts');
}
//10
{
 const s=base('Onay ve YOLO modu',10);text(s,'Varsayılan akış, değişiklik yapabilen işlemlerde kullanıcı onayı ister.',70,216,1120,74,29,C.dark,true);
 bodyLine(s,'Onaylı mod','Araç işlemleri için kullanıcıdan seçim beklenir.',337);
 bodyLine(s,'YOLO modu','Oturum boyunca araç onayları otomatik verilir.',421);
 bodyLine(s,'Kontrol sınırı','Planı uygulamak yine açık /plan apply komutu gerektirir.',505);
 text(s,'Kabuk, kullanıcının yetkileriyle çalışma alanı dışına erişebilir.',72,600,1080,38,22,C.muted);
 note(s,'YOLO oturumluk bir seçenektir, varsayılan kapalıdır. Alt ajanların salt okunur sınırları korunur. Kabuk ve bilgisayar kontrolleri kullanıcının işletim sistemi izinleriyle çalışır.','src/app.ts; src/agent.ts; src/tools/index.ts; src/tools/shell.ts');
}
//11
{
 const s=base('Veri, anahtar ve maliyet',11);point(s,'01','Veri paylaşımı','İlgili dosya ve araç çıktıları seçilen modele gönderilebilir.',240);point(s,'02','Anahtar saklama','Windows’ta yeni kayıt için DPAPI ve dizin güvenliği gerekir.',340);point(s,'03','Maliyet','Model çağrılarının maliyeti sağlayıcı hesabı ve kullanıma bağlıdır.',440);
 darkBand(s,'Gözden geçirme','Hassas veri, ekran görüntüsü ve sağlayıcı şartları değerlendirilmelidir.');
 note(s,'Ekran görüntüleri modele iletilebilir. Windows güvenlik veya DPAPI başarısızlığında yeni kayıt hata verir. Diğer platformlarda kısıtlı dosyada şifrelenmemiş saklama olabilir.','src/secrets.ts; src/providers.ts; src/agent.ts');
}
//12
{
 const s=base('Mevcut durum ve sınırlar',12);text(s,'Mevcut uygulama ile önerilen kurumsal kullanım arasında doğrulama gerekir.',70,218,1100,72,29,C.dark,true);
 bodyLine(s,'Teknik durum','Yerel CLI/TUI, sağlayıcı seçimi ve araç akışları kaynakta mevcut.',331);
 bodyLine(s,'Doğrulama','Kurumsal saha kullanımı için pilot doğrulaması gerekiyor.',421);
 bodyLine(s,'Güvenlik','Standart güvenlik taraması tamamlanmadı. Ayrıca ele alınmalı.',511);
 note(s,'Bu sunum mevcut kaynak ve belgelerin statik incelemesine dayanır. Güvenlik taraması başlatılamamıştır; tamamlanmış rapor veya ölçülmüş ROI iddiası yoktur.','docs/verification.md; README.md');
}
//13
{
 const s=base('Önerilen pilot',13,'ÖNERİ');text(s,'Sınırlı bir ekip ve açıkça tanımlanmış işler ile değerlendirme',72,215,1100,67,30,C.dark,true);
 point(s,'01','Kapsam','Uygun çalışma alanları ve izin verilen görevler belirlenir.',320);
 point(s,'02','Kontrol','Sağlayıcı, veri paylaşımı ve YOLO kullanımı için kurallar yazılır.',410);
 point(s,'03','Değerlendirme','Deneyimler ve gerçekleşen maliyetler pilot sonunda gözden geçirilir.',500);
 note(s,'Bu slayt öneridir, onaylanmış takvim veya performans hedefi değildir. Değerlendirme ölçütleri pilot onayından önce belirlenebilir.','Öneri; README.md; src/app.ts');
}
//14
{
 const s=base('Yönetim kararı ve sonraki adımlar',14,'ÖNERİ');text(s,'Pilot kapsamı ve sorumlu ekip için karar',70,218,1100,68,33,C.dark,true);
 bodyLine(s,'Karar','Sınırlı bir pilotun başlatılmasına yönelik yetki.',322);
 bodyLine(s,'Ön koşul','Veri, güvenlik ve sağlayıcı kullanım kurallarının netleşmesi.',410);
 bodyLine(s,'Çıktı','Pilot sonunda devam, değişiklik veya durdurma değerlendirmesi.',498);
 darkBand(s,'Önerilen yol haritası','Pilot hazırlığı, kontrollü kullanım ve sonuç değerlendirmesi.');
 note(s,'İstenen karar pilot yetkisi ve sorumluların belirlenmesidir. Yol haritası öneridir ve henüz onaylanmış bütçe veya süre içermez.','Öneri; docs/verification.md');
}
for (const [i,s] of deck.slides.items.entries()) { const blob=await deck.export({slide:s,format:'png',scale:1}); await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`), new Uint8Array(await blob.arrayBuffer())); }
const draft=path.join(build,'draft.pptx'); await (await PresentationFile.exportPptx(deck)).save(draft);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({workspaceDir:root,candidatePath:draft,finalPath:out,pythonExecutable:py,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:14,fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(build,'validation-v4.json')});
console.log('Created 14-slide PowerPoint.');
