<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { useProjectSystem } from './composables/useProjectSystem';
import { useCanvasPaint } from './composables/useCanvasPaint';
import { useLineArt } from './composables/useLineArt';
import { useAiGeneration } from './composables/useAiGeneration';
import { debounce } from './utils/common';

// Components
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';
import PalettePanel from './components/PalettePanel.vue';
import ImageControlPanel from './components/ImageControlPanel.vue';
import AaWorkspace from './components/AaWorkspace.vue';
import AaGridOverlay from './components/AaGridOverlay.vue';
import AaReferenceWindow from './components/AaReferenceWindow.vue';
import AaExportModal from './components/AaExportModal.vue';
import AaTimelapseModal from './components/AaTimelapseModal.vue';

import { useI18n } from './composables/useI18n'; // ★追加
import AaHelpModal from './components/AaHelpModal.vue'; // ★インポート
import AaAboutModal from './components/AaAboutModal.vue'; // ★インポート
import AaPrivacyModal from './components/AaPrivacyModal.vue'; // ★インポート

const showPrivacyModal = ref(false); // ★状態追加

const showAboutModal = ref(false); // ★状態追加

const showHelpModal = ref(false); // ★状態追加

const { t, currentLang } = useI18n(); // ★使用開始

// セッション保存キー
const SESSION_KEY = 'aa_editor_session_v1';

// --- Composables ---
const project = useProjectSystem();
const paint = useCanvasPaint();
const lineArt = useLineArt();
const ai = useAiGeneration();

const { projectAAs, currentAAIndex, aaOutput, historyChars } = project;

// --- Local UI State ---
const workspaceRef = ref<InstanceType<typeof AaWorkspace> | null>(null);
const canvasRef = computed(() => workspaceRef.value?.canvasRef || null);
const paintCanvasRef = computed(() => workspaceRef.value?.paintCanvasRef || null);
const paintMaskRef = computed(() => workspaceRef.value?.paintMaskRef || null);

const sidebarTab = ref<'palette' | 'image'>('palette');
const traceOpacity = ref(30);
const aaTextColor = ref('#222222');    
const subTextColor = ref('#ffffff');   
const tracePaneRatio = ref(0.5); 
const showBackgroundImage = ref(true);
const viewMode = ref<'single' | 'split'>('single');
const splitDirection = ref<'horizontal' | 'vertical'>('horizontal');
const isLayoutSwapped = ref(false); 
const showConfigModal = ref(false);
const showDebugModal = ref(false);
const showPaletteEditor = ref(false); 
const showExportImageModal = ref(false);
const showTimelapseModal = ref(false);

// Cursor / Ghost / Menu
const activeEditor = ref<'trace' | 'text' | null>(null);
const caretSyncPos = ref({ x: 0, y: 0 });
const cursorInfo = ref({ row: 1, col: 1, charCount: 0, px: 0 });
const lastCaretIndex = ref(-1);

const isGhostVisible = ref(false);
const ghostText = ref('');
const ghostPos = ref({ x: 0, y: 0 });

const contextMenuVisible = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const contextCandidates = ref<{ char: string, score: number }[]>([]);

// Box Selection
const boxSelectionRects = ref<any[]>([]);
const isBoxSelecting = ref(false);

// Other UI
const showGrid = ref(false);
const refWindowVisible = ref(false);
const refContent = ref({ title: '', content: '' });

// Palette Data
interface Category { id: string; name: string; chars: string; }
const defaultCategories: Category[] = [
{ id: '0', name: '直線', chars: "┌┬┐─├┼┤│└┴┘┏┳┓━┣╋┫┃┗┻┛┠╂┨┰┸┝┿┥┯┷＿__￣‐ｰー一―ｰ‐-=＝二ニﾆ≡三≠｛｝{}〔〕丨！!ｉijｌ|ll∥＼／/マﾏムﾑへヘﾍミﾐ彡丿ノﾉソｿ＜＞〈〉《》巛VＶ∨∧≧≦≪≫"},
{ id: '1', name: '点', chars: "°′″＇＂冫〃丶ヽヾゝゞ´｀¨＾^`\"´`ﾟﾞ''，、､,."},
{ id: '2', name: '曲線', chars: "丿ノﾉソｿ⌒（）()[]ハﾊイｲィｨリﾘソｿンﾝシｼナﾅ弋圦代介ｒrγ廴乂勹癶"},
{ id: '3', name: '分岐線', chars: "∟Ｌ「」ＹYＴTｔtΥ癶λ￢￣⌒⊥丁匚冂厂√丿厶彡从斥斧爪笊气刈斗孑个介仆弋廴辷乂匕圦灯"},
{ id: '4', name: 'まつ毛', chars: "ｨf弐ミｘxｒr示斗劣Y笊狄式弐仏圦沁宍糸心炉芹斥伐苳ｨfﾃ气ﾁ"},
{ id: '5', name: '瞳上', chars: "うん儿か炒云笊芯符爻羔苳斧炙斥升劣升芍芥"},
{ id: '6', name: '瞳下', chars: "し弋(ツしｿ乂少ｼ辷テ"},
{ id: '7', name: '目・にっこり', chars: "ｘ=＝=ミ￢z抖斗弌彳芋"},
{ id: '8', name: '眉', chars: "斗ｫｧﾄ七十"},
{ id: '9', name: '罫線・斜め線', chars: "┌┬┐─├┼┤│└┴┘┏┳┓━┣╋┫┃┗┻┛┠╂┨┰┸┝┿┥┯┷＿￣∥「」=＝二≡三⊂⊃∪∩∈∋⊇⊆丶ヽヾゝゞ´｀＼¨ﾟﾞ巛＜《へヘﾍミﾐ／/丿ノﾉソｿ＞》〆⊿彡∠∟∨∧"},
{ id: '10', name: '記号', chars: "□■◇◆△▲▽▼　○●☆★◎↑→←↓　＋－±×÷＝≠≡≒＜＞≦≧≪≫∞∽∝√∠⊥⌒∂∫∬∴∵∧∨￢⇒⇔∀∃♂♀∇＃＆＊＠§∮※〒〓◯♯♭♪†‡¶￥＄℃￠￡％Å‰°′″丨＇＂冫"},
{ id: '11', name: '記号02', chars: "〃,_^`､l，‐'´》ｰ\"|Ｌ〈、厶｢エ气〉`"},
{ id: '12', name: '記号・ｷﾞﾘｼｬ文字', chars: "イ彳匚亠斤廿个〒┴ΠΤ∞∽∝∩∪υιθσρδбъЦ庁丁了凵∂∟αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ"},
{ id: '13', name: 'ﾃﾞﾌｫ漢字', chars: "一凹叶干久災咋昨皿三山士什十汁升小少上人心壬石川大只中丁刀凸乍二廿入八亡卜又毛夕了丶丿乂亅亠从仆儿兀冂冖冫几凵勹匕匚匸卅卞厂叮叭叨夂宀幵广廾弋彡彳鬥丨＇＂一凹叶干久災咋昨皿山士什十汁升小少上人心壬石川大只中丁刀凸乍二廿入八亡卜又毛夕了丿乂亅亠从仆儿兀冂冖冫几凵勹匕匚匸卅卞厂叮叭叨夂宀幵广廾弋彡彳鬥丨＇＂"},
{ id: '14', name: 'ﾛｰﾏ数字/単位', chars: "ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡㍻〝〟№㏍℡"},
{ id: '15', name: 'ユニ', chars: "&#9829;&#9832;&#9617;&#9618;&#9619;&#9760;&#9745;&#9829;"},
{ id: '16', name: '瞳上', chars: "だ灯行衍仍了乞乍福勝檗繊茫忙佗它赱夾泛弐弍弌乏禾尓迩万亢兀亦不示宍卞抃圦圷下勿狄犾豺坏心雫以付刈刃竹仔拆斥汽气沁う爿"},
{ id: '17', name: '瞳下', chars: "比之杙叱匕廴癶乂込辷弋炒少沙汐乃刈升刋歹"},
{ id: '18', name: '目ﾊﾟｰﾂ', chars: "-━-赱符廿甘戊ﾇx竓芹ミx"},
{ id: '19', name: '区切り線', chars: "━─_￣"},
{ id: '20', name: '王・中・青・己', chars: "一二三十丁工土士壬ヱ干于千王圭至杢玉卦奎中串巨臣言亘車甲申由里画抂扛虹壮青靑音冒曽曹軍暈暉主当肖生缶曼肓膏冐胄胥背已己巳巴邑色曲皿血甚芭改祀々"},
{ id: '21', name: '囗・日・口・亜', chars: "囗冂凵匚匸亡廿卩甘坩印夘犯口田畄曰日目旧月旦且冝但亶明奛炅朋崩萠宜苴宣宙叶叮吐叮叩叨叫呷咀品呂官営侶呈呆古吉杏台召谷亜亞襾唖堊巫亟並坐雨兩爾璽西酉酋丙面両鼎"},
{ id: '22', name: '凵・匚・凸', chars: "凵凶幽函凾网囘冏内肉鬯可竒鬲匚区匡匣匪區匝匹匿匱嘔奩嫗嶇歐甌毆扈凸凹卍占貞歯鹵齒囓"},
{ id: '23', name: '白・隹', chars: "白臼自百首月用角骨皂皇畠隹直甫甬耳県售瞿集唯寉焦甯匍真眞"},
{ id: '24', name: '冊・典・丑', chars: "冊册弗刪柵嗣非韭菲韮扉斐暃典再苒冉而円母毋苺更五丑与互彑亙瓦立片爿牙淵壯奘弉"},
{ id: '25', name: '廾・巾・川・人', chars: "廾升卅丗丱艸幵卉井丼并亦奔弄刊刑刔刺鼻尭巾市吊帛屯帝啻帚亭甼町奄尚岡罔高暠川州冫彳巛彡彦疹災莖徑頸人入从丿乂艾文又叉爻交殳攵乙乞叺呎臥"},
{ id: '26', name: '斤・几・力', chars: "斤斥爪瓜斧呱狐抓弧派乍尓寸才欠作咋听吋芹笊几凡丹舟凱冗亢兌咒克九丸氿吭帆力刀刃勿匁匆刄刎彧昜笏切刧"},
{ id: '27', name: '勹・弓・久', chars: "勹勺匀匀旬甸匂匀勾匈包弓弖弔弗弟第丐巧号咢夸弯弩穹弭弸拂佛沸久夂夊夕歹夛万方乃及吸冬麦舛宛梦灸多双"},
{ id: '28', name: '八・儿・兄・只', chars: "八六穴介价界斉斎以似儿兀允元乢礼糺朮皃尢尤旡无就列別兄兇兒兜先充赤免兔只兵共呉宍黄寅其具真冥巽興貝負貢責貴賈頁"},
{ id: '29', name: '史・大・哭', chars: "史吏哀衰喪套大犬太丈天夫夭失矢矣奚央夬欠支爽夾哭臭尖奧奐"},
{ id: '30', name: '木・夲・手・乗', chars: "木本米禾釆忝未末千午牛辛半求平乎来宋杰夲卆呆早旱阜革巣単皐竍竏手耒拜豕豸彖豪毫毛羊美羔善奉奏秦拿掌庠乗乘剩示京亰東事争聿爭隶兼業畢身垂埀堯"},
{ id: '31', name: '厂・广・尸・乕・布', chars: "厂屮仄灰厄圧厓厘辰晨声昃广庁庄庶卮危卷后巵巷尸戸尺尽尼局屆眉尻届屏屓屑乕尹伊笋夷為爲寿肅粛嘯庸蕭書晝墨布左右石名倉蒼存在宕岩缶"},
{ id: '32', name: '子・女・心・匕・厶・民', chars: "子孑予矛斗仔孖孔孟季孚孕斈女奴妁妝妍委宴妥妾姜嫋心必恥忌志忍忽怱毖怎恚患悪惡匕七它虍它宅旨也世厶幺糸玄亥刻幻眩紊小少公分枩牟罕広宏禺丘氏民艮良衣虫云去会長套岳岻帋帶"},
{ id: '33', name: '足・个', chars: "足疋定是气從之乏走赱鬼魂个仝命全舎僉盒傘翕禽會歛龠嶮崘崙曾甞"},
{ id: '34', name: '廴・門・凩・癶', chars: "廴廻辷迅込辻近述迷爬処庭昶瓧咫旭毬剋尅門閂閃閊閘閏閨閭閒關鬥凩凧凪凬夙凰鼡癶癸発溌"},
{ id: '35', name: '山・ｲ・囗・口', chars: "岦嵜崗崔嵐崖崑屶峇崗岑岺岌峠什仞仭仗付仍代行仁回囮圀圄叶叨叮吐吋呟呪咄喘"},
{ id: '36', name: '弋・竹・彡・ｼ', chars: "弋戈弌弍弐式戒或戓戞戛曵戉戊戍戎戌成竺笄竿符笹杉衫彩髟形尨巡參寥廖勠汁汀江汗汪汕氿汽汎汚涯"},
{ id: '37', name: '花・皿・罘', chars: "花芥苅茄芙芋華芍荀菊芒芦茵茴菌盂盈盖盃盆盟盥益益盒罘罟罪置"},
{ id: '38', name: '卯・炎・棘・辨', chars: "卯卵卿不火水氷永丕丞兆北竹泉汞沓燕蒸承否呑多炎棗羹芻哥戔啖彁彊斷能毯爼疆皺赫棘孖弱羽羽兢喆林勞嚇菻蒜淋嵶彗晉普昆栞梺辨嬲嫐弼斑欒娚"},
{ id: '39', name: '器・品・竜', chars: "器噐囂薑啜嵓嵒皃品晶劦刕淼森犇毳姦毳皛矗囁孱攝茘蕊蕋脇協巒巖竜亀竃黽龍壟鼠竄馬鳥魚翔翡跫壷壺壼薹蝨嘉壽"},
{ id: '40', name: '豆・歪・加', chars: "豆豈豊壹畳疂歪奣尖劣岔岱加伽刈刋外叭叱仂化仆仏比舛功加劜礼扣"},
{ id: '41', name: '花', chars: "艾"},
];
const categories = ref<Category[]>(JSON.parse(JSON.stringify(defaultCategories)));
const editingCatId = ref<string | null>(null);
const editingCategory = computed(() => categories.value.find(c => c.id === editingCatId.value));

const fontStack = computed(() => ai.customFontName.value === 'Saitamaar' ? `'MSP_Parallel', 'Saitamaar'` : `'${ai.customFontName.value}'`);

// ★追加: ドラッグアンドドロップの状態管理
const isDragOver = ref(false);

const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    isDragOver.value = true;
};

const onDragOver = (e: DragEvent) => {
    e.preventDefault(); // これがないとdropイベントが発火しない
    isDragOver.value = true;
};

const onDropFile = (e: DragEvent) => {
    e.preventDefault();
    isDragOver.value = false;
    
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        const file = files[0]!;
        if (file.type.startsWith('image/')) {
            // 既存の画像読み込み関数を再利用
            onImageLoaded(file);
            project.showToastMessage('Image Loaded via Drop');
        } else {
            project.showToastMessage('Please drop an image file');
        }
    }
};

// --- Methods ---

// ★状態を保存する関数
const saveSession = () => {
    if (!paint.canvasDims.value) return;

    // 画像データのBase64化
    let imgDataUrl = '';
    if (paint.sourceImage.value) {
        // 現在の画像をキャンバスに描画してDataURLを取得
        const tempCvs = document.createElement('canvas');
        tempCvs.width = paint.sourceImage.value.width;
        tempCvs.height = paint.sourceImage.value.height;
        const ctx = tempCvs.getContext('2d')!;
        ctx.drawImage(paint.sourceImage.value, 0, 0);
        imgDataUrl = tempCvs.toDataURL('image/png');
    }

    const sessionData = {
        // プロジェクトデータ
        projectAAs: project.projectAAs.value,
        currentAAIndex: project.currentAAIndex.value,
        
        // 画像の状態
        imgDataUrl: imgDataUrl,
        imgTransform: paint.imgTransform.value,
        
        // パレット (LocalStorage 'aa_palette_v1' にも保存されているが、念のため)
        categories: categories.value,
        
        // AI設定
        fontName: ai.customFontName.value,
        allowedChars: ai.config.value.allowedChars,
        // (注: カスタムフォントファイル自体はLocalStorage容量制限(約5MB)のため保存が困難です。
        //  フォント名だけ保存し、再訪時はデフォルトor再アップロードを促すのが一般的です)
        
        // UI状態
        aaTextColor: aaTextColor.value,
        subTextColor: subTextColor.value,
        traceOpacity: traceOpacity.value,
        // ★追加: 言語設定
        lang: currentLang.value,
    };

    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
        // project.showToastMessage('Session Auto-Saved'); // 頻繁に出るとうざいのでコメントアウト
    } catch (e) {
        console.warn('Session save failed (likely quota exceeded):', e);
    }
};

// ★状態を復元する関数
const loadSession = async () => {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return false;

    try {
        const data = JSON.parse(saved);

        // 1. テキスト復元
        if (data.projectAAs) project.projectAAs.value = data.projectAAs;
        if (typeof data.currentAAIndex === 'number') project.currentAAIndex.value = data.currentAAIndex;

        // 2. パレット復元
        if (data.categories) categories.value = data.categories;

        // 3. AI設定復元
        //if (data.fontName) ai.customFontName.value = data.fontName;
        if (data.allowedChars) {
            ai.config.value.allowedChars = data.allowedChars;
            ai.updateAllowedChars();
        }

        // 4. 色・UI復元
        if (data.aaTextColor) aaTextColor.value = data.aaTextColor;
        if (data.subTextColor) subTextColor.value = data.subTextColor;
        if (data.traceOpacity) traceOpacity.value = data.traceOpacity;
        if (data.imgTransform) paint.imgTransform.value = data.imgTransform;

        // ★追加: 言語設定の復元
        if (data.lang) currentLang.value = data.lang;
        // 4. 画像復元 (非同期)
        if (data.imgDataUrl) {
            const img = new Image();
            img.src = data.imgDataUrl;
            img.onload = async () => {
                paint.sourceImage.value = img;
                paint.imageSize.value = { w: img.width, h: img.height };
                paint.initPaintBuffer(img.width, img.height);
                await paint.updateCanvasDimensions();
                
                // ★重要: 画像読み込みによるリセットを防ぐため、ここで再度変形を適用する
                if (data.imgTransform) {
                    paint.imgTransform.value = data.imgTransform;
                    // 必要であれば updateImageTransformWrapper() などを呼ぶ
                    if (typeof updateImageTransformWrapper === 'function') {
                        updateImageTransformWrapper(); 
                    }
                }

                await nextTick();
                renderAllCanvases();
                project.showToastMessage('Session Restored');
            };
        }
        return true;
    } catch (e) {
        console.error('Failed to load session', e);
        return false;
    }
};

// パレットインポートのハンドラ (PalettePanelからのイベント)
const handleImportPalette = (newCategories: any[]) => {
    categories.value = newCategories;
    savePaletteToStorage(); // 永続化
    project.showToastMessage('Palette Imported');
};

// リセットハンドラ (Configモーダル等から呼ぶ想定)
const handleResetAiConfig = async () => {
    if(!confirm("Reset Font and Allowed Characters to default?")) return;
    await ai.resetConfig();
    project.showToastMessage('AI Config Reset');
};

const loadPaletteFromStorage = () => {
    const saved = localStorage.getItem('aa_palette_v1');
    if (saved) { try { categories.value = JSON.parse(saved); } catch(e) {} }
};
const savePaletteToStorage = () => { localStorage.setItem('aa_palette_v1', JSON.stringify(categories.value)); };
const addCategory = () => {
    const newId = Date.now().toString();
    categories.value.push({ id: newId, name: 'New Category', chars: '' });
    editingCatId.value = newId;
    savePaletteToStorage();
};
const removeCategory = (id: string) => {
    if (!confirm("Delete this category?")) return;
    categories.value = categories.value.filter(c => c.id !== id);
    if (editingCatId.value === id) editingCatId.value = null;
    savePaletteToStorage();
};
const moveCategory = (idx: number, dir: number) => {
    const target = idx + dir;
    if (target >= 0 && target < categories.value.length) {
        const temp = categories.value[idx];
        categories.value[idx] = categories.value[target]!;
        categories.value[target] = temp!;
        savePaletteToStorage();
    }
};

// --- ★修正: アプリ起動時の初期化 ---
onMounted(async () => {
    project.resetHistory();
    loadPaletteFromStorage();
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('mousemove', onGlobalMouseMove);
    await ai.initEngine();
    
    // ★セッション復元を試みる
    const restored = await loadSession();

    if (!restored) {
        // 復元データがない場合はデフォルト(白紙)初期化
        const defaultW = 800; const defaultH = 600;
        const canvas = document.createElement('canvas');
        canvas.width = defaultW; canvas.height = defaultH;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, defaultW, defaultH);
        const url = canvas.toDataURL();
        const img = new Image(); img.src = url;
        img.onload = async () => {
            paint.sourceImage.value = img;
            paint.imageSize.value = { w: defaultW, h: defaultH };
            paint.initPaintBuffer(defaultW, defaultH);
            paint.imgTransform.value = { x: 0, y: 0, scale: 1.0, rotation: 0 };
            await paint.updateCanvasDimensions();
            await nextTick();
            renderAllCanvases();
        };

    }
    // オートセーブのトリガー設定 (変更検知)
    // 負荷軽減のため debounce をかけて保存
    const debouncedSave = debounce(saveSession, 2000); // 2秒ごとに保存
    
    watch([
        project.aaOutput, 
        paint.imgTransform, 
        aaTextColor, 
        ai.config.value,
        currentLang // ★追加: 言語が変わった時も保存
    ], () => debouncedSave(), { deep: true });
});

onUnmounted(() => {
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('mousemove', onGlobalMouseMove);
});

// Wrappers
const addNewPage = () => { project.addNewAA(); showGrid.value = false; };
const deletePage = (idx: number) => { if (confirm('Delete page?')) project.deleteAA(idx); };
const duplicatePage = () => {
    const current = projectAAs.value[currentAAIndex.value];
    if (current) {
        projectAAs.value.push({ title: current.title + ' (Copy)', content: current.content });
        currentAAIndex.value = projectAAs.value.length - 1;
        project.showToastMessage('Page Duplicated');
    }
};
const toggleRef = () => {
    if (!refWindowVisible.value) {
        refContent.value = { title: projectAAs.value[currentAAIndex.value]?.title || 'Ref', content: aaOutput.value };
        refWindowVisible.value = true;
    } else refWindowVisible.value = false;
};
const toggleLayoutWrapper = (mode: string) => {
    if (mode === 'single') viewMode.value = 'single';
    else { viewMode.value = 'split'; splitDirection.value = mode === 'split-h' ? 'horizontal' : 'vertical'; }
};
const triggerLoadWrapper = (enc: string) => { project.loadEncoding.value = enc as any; document.getElementById('fileInput')?.click(); };
const toggleSafeMode = () => { ai.initEngine(); project.updateSyntaxHighlight(ai.config.value.safeMode); };

// Image & AI
const onImageLoaded = (file: File) => {
    if (!ai.isReady.value) return;
    const img = new Image(); img.src = URL.createObjectURL(file);
    img.onload = async () => {
        paint.sourceImage.value = img; paint.imageSize.value = { w: img.width, h: img.height };
        paint.initPaintBuffer(img.width, img.height);
        sidebarTab.value = 'image'; paint.paintMode.value = 'move';
        await nextTick();
        paint.imgTransform.value = { x: 0, y: 0, scale: 1.0, rotation: 0 };
        await paint.updateCanvasDimensions();
        lineArt.rawLineArtCanvas.value = null; lineArt.processedSource.value = null;
        if (lineArt.thinningLevel.value > 0) lineArt.processSourceImage(null, img);
        ai.status.value = 'IMAGE LOADED';
        renderAllCanvases();
    };
};
const renderAllCanvases = () => {
    if (!canvasRef.value || !paintCanvasRef.value) return;
    const src = lineArt.processedSource.value || paint.sourceImage.value;
    renderLayer(canvasRef.value, src);
    if (paint.paintBuffer.value) renderLayer(paintCanvasRef.value, paint.paintBuffer.value);
};
const renderLayer = (targetCanvas: HTMLCanvasElement, source: HTMLImageElement | HTMLCanvasElement | null) => {
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

    if (targetCanvas === canvasRef.value) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height); }
    if (!source) return;
    ctx.save();
    ctx.translate(paint.imgTransform.value.x, paint.imgTransform.value.y);
    ctx.rotate(paint.imgTransform.value.rotation * Math.PI / 180);
    ctx.scale(paint.imgTransform.value.scale, paint.imgTransform.value.scale);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0);
    ctx.restore();
};
const updateImageTransformWrapper = async () => { await paint.updateCanvasDimensions(); renderAllCanvases(); };
const processImageWrapper = () => { if (canvasRef.value) ai.runGeneration(canvasRef.value, paint.paintBuffer.value, paint.imgTransform.value, project.aaOutput); };
const extractLineArtWrapper = async () => { 
    if (paint.sourceImage.value) { await lineArt.extractLineArt(paint.sourceImage.value); sidebarTab.value = 'image'; renderAllCanvases(); } 
};
const onFontFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
      const url = URL.createObjectURL(file);
      const fontName = file.name.split('.')[0];
      ai.status.value = 'OPTIMIZING AI...';
      await new Promise(r => setTimeout(r, 50));
      try {
          ai.engine.mode = 'vector';
          ai.customFontName.value = fontName!;
          await ai.engine.updateDatabase(url, ai.config.value.allowedChars, fontName!);
          ai.status.value = 'READY (VEC)';
      } catch (err) { console.error(err); ai.status.value = 'FONT ERROR'; }
  }
};
const swapColors = () => { const t = aaTextColor.value; aaTextColor.value = subTextColor.value; subTextColor.value = t; };
const invertColor = () => { 
    let hex = aaTextColor.value.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    aaTextColor.value = y > 128 ? '#222222' : '#ffffff';
};

// Paint Logic
const onMouseDownCanvas = (e: MouseEvent) => {
    if (ai.isProcessing.value) return;
    if (paint.paintMode.value === 'move') {
        paint.isDraggingImage.value = true;
        paint.lastMousePos.value = { x: e.clientX, y: e.clientY };
        e.preventDefault(); return;
    }
    
    // バッファがない場合の安全策（onMountedで初期化されるはずだが念のため）
    if (!paint.paintBuffer.value) {
        if (paint.sourceImage.value) {
            paint.initPaintBuffer(paint.sourceImage.value.width, paint.sourceImage.value.height);
        } else {
            return; // 画像もバッファもなければ何もしない
        }
    }
    
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const imgPos = paint.toImageSpace(screenPos.x, screenPos.y);
    
    if (paint.paintMode.value === 'bucket') {
        const bg = lineArt.processedSource.value || paint.sourceImage.value;
        if (bg) paint.performFloodFill(imgPos.x, imgPos.y, e.button === 2, bg);
        renderAllCanvases();
    } else {
        const ctx = paint.paintBuffer.value!.getContext('2d', { willReadFrequently: true })!;
        ctx.beginPath(); ctx.moveTo(imgPos.x, imgPos.y);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        
        (window as any).isPaintDragging = true; 
        (window as any).lastImgPos = imgPos;

        const isEraser = paint.paintMode.value === 'eraser' || e.buttons === 2;
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        
        // ★修正: Flowモードなら黒 (#000000)
        if (!isEraser) {
            if (paint.paintMode.value as any === 'flow') {
                ctx.strokeStyle = '#000000'; 
            } else {
                ctx.strokeStyle = paint.paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
            }
        }
        
        ctx.lineWidth = paint.brushSize.value; 
        ctx.lineTo(imgPos.x, imgPos.y); 
        ctx.stroke();
        renderAllCanvases();
    }
};

const onGlobalMouseMove = (e: MouseEvent) => {
    if (ai.isProcessing.value) return;
    if (paint.isDraggingImage.value && paint.paintMode.value === 'move') {
        const dx = e.clientX - paint.lastMousePos.value.x;
        const dy = e.clientY - paint.lastMousePos.value.y;
        paint.imgTransform.value.x += dx; paint.imgTransform.value.y += dy;
        paint.lastMousePos.value = { x: e.clientX, y: e.clientY };
        requestAnimationFrame(() => renderAllCanvases());
        return;
    }
    if (sidebarTab.value === 'image' && (window as any).isPaintDragging && paint.paintBuffer.value && paintMaskRef.value) {
         const rect = paintMaskRef.value.getBoundingClientRect();
         const imgPos = paint.toImageSpace(e.clientX - rect.left, e.clientY - rect.top);
         const lastPos = (window as any).lastImgPos;
         
         const ctx = paint.paintBuffer.value.getContext('2d')!;
         ctx.lineWidth = paint.brushSize.value; ctx.lineCap='round'; ctx.lineJoin='round';
         
         const isEraser = paint.paintMode.value === 'eraser' || e.buttons === 2;
         ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
         
         // ★修正: Flowモードなら黒
         if(!isEraser) {
             if (paint.paintMode.value as any === 'flow') {
                 ctx.strokeStyle = '#000000'; 
             } else {
                 ctx.strokeStyle = paint.paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
             }
         }
         
         ctx.beginPath(); ctx.moveTo(lastPos.x, lastPos.y); ctx.lineTo(imgPos.x, imgPos.y); ctx.stroke();
         (window as any).lastImgPos = imgPos;
         requestAnimationFrame(() => renderAllCanvases());
    }
};

const onGlobalMouseUp = () => { 
    paint.isDraggingImage.value = false; 
    (window as any).isPaintDragging = false; 
    
    if ((window as any).isFlowPainting) {
        (window as any).isFlowPainting = false;
        project.commitHistory(); 
    }
};

const onConfigUpdate = async () => { await ai.updateAllowedChars(); project.updateSyntaxHighlight(ai.config.value.safeMode); };
const addCharWrapper = (char: string) => {
    if (!char) return;
    project.recordCharHistory(char);
    if (workspaceRef.value) workspaceRef.value.insertAtCursor(char, activeEditor.value || 'trace');
};
const updateLineArtPreview = debounce(() => {
    if (!paint.sourceImage.value) return;
    if (lineArt.rawLineArtCanvas.value) lineArt.applyLineArtSettings(paint.sourceImage.value);
    else lineArt.processSourceImage(null, paint.sourceImage.value);
    renderAllCanvases();
}, 150);
watch([() => lineArt.lineArtSettings.value, () => lineArt.thinningLevel.value], () => updateLineArtPreview(), { deep: true });
watch(
    [project.aaOutput, () => ai.config.value.bbsMode], 
    ([, bbsMode]) => {
        project.updateSyntaxHighlight(!!bbsMode);
    }
);

// ... (以下、Cursor Helper 等は変更なしのため省略。以前のコードと同じです) ...
const getCaretPixelPos = (textarea: HTMLTextAreaElement, text: string, caretIdx: number) => {
    const textBefore = text.substring(0, caretIdx);
    const lines = textBefore.split('\n');
    const row = lines.length - 1;
    const currentLineText = lines[row]!;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px "${ai.customFontName.value}"`;
    const textWidth = ctx.measureText(currentLineText).width;
    const style = window.getComputedStyle(textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 10;
    const paddingTop = parseFloat(style.paddingTop) || 10;
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const y = (row * 16) + paddingTop + borderTop - textarea.scrollTop;
    const x = textWidth + paddingLeft + borderLeft - textarea.scrollLeft;
    return { x, y, row, col: currentLineText.length };
};

const updateGhostSuggestion = debounce(async (textarea: HTMLTextAreaElement) => {
    if (!paint.sourceImage.value || !ai.isReady.value) return;
    if (textarea.selectionStart !== textarea.selectionEnd) { isGhostVisible.value = false; return; }
    const pos = getCaretPixelPos(textarea, project.aaOutput.value, textarea.selectionStart);
    if (!pos) return;
    if (pos.y < 0 || pos.y > paint.canvasDims.value.height || pos.x < 0 || pos.x > paint.canvasDims.value.width) {
        isGhostVisible.value = false; return; 
    }
    const suggestion = await ai.getSuggestion(
        workspaceRef.value!.canvasRef!, 
        paint.paintBuffer.value, 
        paint.imgTransform.value, 
        pos.x, 
        pos.y + 8 
    );
    if (suggestion && suggestion.trim().length > 0) {
        ghostText.value = suggestion;
        ghostPos.value = { x: pos.x, y: pos.y };
        isGhostVisible.value = true;
    } else {
        isGhostVisible.value = false;
    }
}, 100);

const onTextCursorMove = (e: Event) => {
    contextMenuVisible.value = false;
    const target = e.target as HTMLTextAreaElement;
    if (!target) return;
    if (target.selectionStart === lastCaretIndex.value) return;
    lastCaretIndex.value = target.selectionStart;
    isGhostVisible.value = false;
    updateGhostSuggestion(target);
    const pos = getCaretPixelPos(target, project.aaOutput.value, target.selectionStart);
    if (pos) {
        cursorInfo.value = { row: pos.row, col: pos.col, charCount: project.aaOutput.value.length, px: cursorInfo.value.px };
    }
};
const onCursorInfoUpdate = (info: { px: number }) => { cursorInfo.value.px = info.px; };

const onTextKeyDown = async (e: KeyboardEvent) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const direction = e.key === 'ArrowRight' ? 1 : -1;
            if (workspaceRef.value) {
                workspaceRef.value.nudgeCursor(direction, ai.config.value.useThinSpace, ai.config.value.bbsMode);
            }
            return;
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) project.redo(); else project.undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); e.stopPropagation();
        project.redo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (workspaceRef.value?.hasBoxSelection) {
            e.preventDefault(); e.stopPropagation(); onTriggerCopy('normal'); return;
        }
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        if (workspaceRef.value) {
            if (isGhostVisible.value) {
                const char = ghostText.value;
                workspaceRef.value.insertAtCursor(char, activeEditor.value || 'trace');
                isGhostVisible.value = false;
                await nextTick();
                const ta = (activeEditor.value === 'text' ? (workspaceRef.value as any).textTextareaRef : (workspaceRef.value as any).traceTextareaRef) as HTMLTextAreaElement;
                if (ta) updateGhostSuggestion(ta);
            } else {
                workspaceRef.value.insertAtCursor('　', activeEditor.value || 'trace');
            }
        }
        return;
    }
    if (isGhostVisible.value && !['Shift', 'Control', 'Alt'].includes(e.key)) {
        isGhostVisible.value = false;
    }
};

const onRequestContextMenu = async (e: MouseEvent, target: HTMLTextAreaElement) => {
    contextMenuPos.value = { x: e.clientX, y: e.clientY };
    await nextTick(); 
    if (ai.isReady.value && paint.sourceImage.value) {
        const pos = getCaretPixelPos(target, project.aaOutput.value, target.selectionStart);
        if (pos && workspaceRef.value?.canvasRef) {
            const candidates = await ai.getCandidates(workspaceRef.value.canvasRef, paint.paintBuffer.value, paint.imgTransform.value, pos.x, pos.y + 8);
            contextCandidates.value = candidates;
        } else { contextCandidates.value = []; }
    } else { contextCandidates.value = []; }
    contextMenuVisible.value = true;
};
const onSelectCandidate = (char: string) => {
    if (workspaceRef.value) workspaceRef.value.insertAtCursor(char, activeEditor.value);
    contextMenuVisible.value = false; isGhostVisible.value = false;
};
const onPasteBox = async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { alert('Clipboard access denied'); return; }
    if (workspaceRef.value && text) { workspaceRef.value.pasteTextAsBox(text); project.showToastMessage('Rect Paste Applied'); }
};
const onTriggerCopy = async (mode: 'normal' | 'bbs') => {
    if (workspaceRef.value?.hasBoxSelection) {
        const boxText = workspaceRef.value.getBoxSelectionText();
        if (boxText) { await navigator.clipboard.writeText(boxText); project.showToastMessage('Rect Copied!'); return; }
    }
    project.triggerCopy(mode);
};

const showColorPickerModal = ref(false);
const colorPickerTarget = ref<'main' | 'sub'>('main');
const openColorPicker = (target: 'main' | 'sub') => { colorPickerTarget.value = target; showColorPickerModal.value = true; };
// ★修正後: 第2引数で閉じるかどうかを制御できるように変更
const applyColorFromModal = (color: string, closeModal = true) => {
    if (colorPickerTarget.value === 'main') {
        aaTextColor.value = color;
    } else {
        subTextColor.value = color;
    }
    
    // 指定された場合のみ閉じる
    if (closeModal) {
        showColorPickerModal.value = false;
    }
};
const presetColors = ['#222222', '#000000', '#444444', '#666666', '#888888', '#aaaaaa', '#cccccc', '#ffffff', '#5c0000', '#ff0000', '#ff8888', '#ffcccc', '#00005c', '#0000ff', '#8888ff', '#ccccff', '#004400', '#008000', '#88ff88', '#ccffcc', '#4a3b32', '#8b4513', '#e6b086', '#f5deb3'];

// ★ Flow Paint終了時の処理 (ガード処理と合成処理)
const onFlowPaintEnd = async (rect: { minY: number, maxY: number }) => {
    // 準備ができていない、または描画バッファがない場合は何もしない
    if (!ai.isReady.value || !paint.paintBuffer.value) return;
    console.log("test1")
    // ガード: バッファサイズが0ならエラーになるのでリターン
    if (paint.paintBuffer.value.width === 0 || paint.paintBuffer.value.height === 0) return;
    console.log("test2")
    // paint.sourceImage (元画像) がない場合でも、onMountedで初期化されているはずだが
    // 万が一のガード
    if (!paint.sourceImage.value) return;
    console.log("test3")
    // AI推論を実行
    // CanvasRef(画面表示)ではなく、SourceImage(元データ) と PaintBuffer(手書き) を合成して推論する
    const currentText = project.aaOutput.value;
    const newText = await ai.generateRows(
        paint.sourceImage.value as any, // 元画像 (白紙orロードした画像)
        paint.paintBuffer.value, // 手書き線
        paint.imgTransform.value,
        currentText,
        rect.minY,
        rect.maxY
    );
    
    project.aaOutput.value = newText;
    project.commitHistory();
    
    // ★重要: 描画した線を消さずに残す
    // PaintBufferは「今回描いた線」。これを残しておくと、次の描画と重なってしまうので、
    // ここでは「消さない」というユーザーの要望を実現するために、
    // 本来は「PaintBufferをSourceImageに合成(焼き込み)」する必要があるが、
    // HTMLImageElementへの書き込みはできない。
    // 
    // そのため、ここでは「PaintBufferの内容は維持する」だけにしておくのが一番シンプル。
    // 次回の描画(onMouseDown)で、前の線が消えないように、
    // onMouseDownでの `ctx.clearRect` をしないなどの工夫が必要だが、
    // 現在の仕様では PaintBuffer はオーバーレイとして機能しているので、
    // 「消さない」だけで、線は残り続ける。
    
    // ただし、generateRowsには毎回「すべての線」が渡されることになるため、
    // 線が増えるたびに推論結果が更新されていく。これでOK。
};

// ★追加: サンプル画像を読み込む関数
const loadSampleImage = async () => {
    try {
        const response = await fetch('/sample.png');
        if (!response.ok) throw new Error('Sample image not found');
        const blob = await response.blob();
        const file = new File([blob], "sample.png", { type: "image/png" });
        onImageLoaded(file); // 既存の読み込みロジックを再利用
        project.showToastMessage('Sample Image Loaded');
    } catch (e) {
        console.error(e);
        project.showToastMessage('Failed to load sample.png');
    }
};

watch(() => ai.isReady.value, (ready) => { if (ready) project.showToastMessage("AI Engine Ready! Let's craft."); });
watch(aaOutput, () => { if (ai.config.value.safeMode) project.updateSyntaxHighlight(true); });
</script>

<template>
  <div class="app-root" :style="{ '--aa-text-color': aaTextColor, '--font-aa': fontStack }"
    @dragenter="onDragEnter"
     @dragover="onDragOver"
     @dragleave="isDragOver = false"
     @drop="onDropFile">
    <AppHeader 
    :status="ai.status.value" 
    :is-ready="ai.isReady.value" 
    :is-processing="ai.isProcessing.value"
    @toggle-debug="showDebugModal=true" 
    @toggle-config="showConfigModal=true"
    @toggle-help="showHelpModal = true"
    @toggle-about="showAboutModal = true"
    />

    <div class="workspace">
      <AaWorkspace ref="workspaceRef" v-model:aa-output="aaOutput" v-model:current-aa-title="projectAAs[currentAAIndex]!.title" :font-stack="fontStack" :is-painting-active="sidebarTab === 'image'" @click-text="onTextCursorMove" @keyup-text="onTextCursorMove" @keydown-text="onTextKeyDown" @cursor-info-update="onCursorInfoUpdate" @flow-paint-end="onFlowPaintEnd" :context-menu-visible="contextMenuVisible" :context-menu-pos="contextMenuPos" :context-candidates="contextCandidates" @request-context-menu="onRequestContextMenu" @select-candidate="onSelectCandidate" @close-context-menu="contextMenuVisible = false" v-model:trace-pane-ratio="tracePaneRatio" :view-mode="viewMode" :split-direction="splitDirection" :is-layout-swapped="isLayoutSwapped" :source-image="paint.sourceImage.value" :canvas-dims="paint.canvasDims.value" :trace-opacity="traceOpacity" :show-background-image="showBackgroundImage" :show-grid-overlay="false" :paint-mode="paint.paintMode.value" :caret-sync-pos="caretSyncPos" :is-box-selecting="isBoxSelecting" :box-selection-rects="boxSelectionRects" :is-ghost-visible="isGhostVisible" :ghost-pos="ghostPos" :ghost-text="ghostText" :aa-text-color="aaTextColor" :highlighted-h-t-m-l="project.highlightedHTML.value" @active-editor="val => activeEditor = val" @mousedown-canvas="onMouseDownCanvas" @input-text="e => {console.log(e.target)}" @paste-text="e => project.handlePaste(e, e.target as HTMLTextAreaElement)" />
        <aside class="sidebar">
        <div class="sidebar-tabs">
            <button :class="{ active: sidebarTab==='palette' }" @click="sidebarTab='palette'">📝 Palette</button>
            <button :class="{ active: sidebarTab==='image' }" @click="sidebarTab='image'">🎨 Image</button>
        </div>
        
        <div class="sidebar-scroll-container" :class="{ 'scroll-y': sidebarTab === 'image' }">
            <PalettePanel v-show="sidebarTab==='palette'"
                :history-chars="historyChars" :project-a-as="projectAAs" :current-a-a-index="currentAAIndex" :categories="categories"
                @add-char="addCharWrapper" @select-aa="idx => { currentAAIndex = idx; }" 
                @delete-aa="deletePage" @add-new-aa="addNewPage" @show-palette-editor="showPaletteEditor=true"
                @import-palette="handleImportPalette"
                :font-stack="ai.customFontName.value"
            />

            <ImageControlPanel v-show="sidebarTab==='image'"
                :source-image="paint.sourceImage.value" :is-processing="ai.isProcessing.value"
                :is-extracting="lineArt.isExtracting.value"
                :raw-line-art-canvas="lineArt.rawLineArtCanvas.value" :line-art-settings="lineArt.lineArtSettings.value"
                :trace-opacity="traceOpacity" :img-transform="paint.imgTransform.value"
                :paint-mode="paint.paintMode.value" :paint-color="paint.paintColor.value" :brush-size="paint.brushSize.value"
                :target-char-blue="ai.targetCharBlue.value" :target-char-red="ai.targetCharRed.value"
                :thinning-level="lineArt.thinningLevel.value" :noise-gate="ai.config.value.noiseGate" :generation-mode="ai.config.value.generationMode"
                @load-image="onImageLoaded" @extract-lineart="extractLineArtWrapper"
                @reset-lineart="() => { lineArt.rawLineArtCanvas.value=null; renderAllCanvases(); }"
                @process-image="processImageWrapper"
                @update:img-transform="val => { paint.imgTransform.value = val; updateImageTransformWrapper(); }"
                @update:paint-mode="val => paint.paintMode.value = val as any"
                @update:paint-color="val => paint.paintColor.value = val as any"
                @update:brush-size="val => paint.brushSize.value = val"
                @update:trace-opacity="val => traceOpacity = val"
                @update:line-art-settings="val => lineArt.lineArtSettings.value = val"
                @update:thinning-level="val => lineArt.thinningLevel.value = val"
                @update:noise-gate="val => ai.config.value.noiseGate = val"
                @update:generation-mode="val => ai.config.value.generationMode = val as any"
                @update:target-char-blue="val => ai.targetCharBlue.value = val"
                @update:target-char-red="val => ai.targetCharRed.value = val"
                @load-sample="loadSampleImage"
            />
        </div>

        <Transition name="fade">
            <div v-if="lineArt.isExtracting.value && sidebarTab === 'image'" class="sidebar-overlay">
                <div class="sidebar-spinner"></div>
                <div class="sidebar-overlay-text">Extracting...</div>
            </div>
        </Transition>
        </aside>
    </div>

    <AppFooter 
        :current-aa-index="currentAAIndex" :total-a-as="projectAAs.length"
        :title="projectAAs[currentAAIndex]?.title || ''"
        :cursor-info="cursorInfo" :is-box-selecting="isBoxSelecting"
        :view-mode="viewMode" :show-background-image="showBackgroundImage"
        
        v-model:aa-text-color="aaTextColor" 
        v-model:sub-text-color="subTextColor"
        
        @nav-prev="currentAAIndex = Math.max(0, currentAAIndex - 1)"
        @nav-next="currentAAIndex = Math.min(projectAAs.length - 1, currentAAIndex + 1)"
        @toggle-grid="showGrid = !showGrid" @duplicate="duplicatePage" @pin-ref="toggleRef"
        @delete="deletePage(currentAAIndex)" @undo="project.undo" @redo="project.redo"
        @trigger-load="triggerLoadWrapper" @save="(fmt, enc) => project.onSaveFile(fmt, enc as any)"
        @copy="mode => project.triggerCopy(mode as any)" @show-export="showExportImageModal = true"
        @apply-edit="val => project.applyTextEdit(val, ai.customFontName.value)"
        @paste-box="onPasteBox"
        @toggle-layout="toggleLayoutWrapper" @swap-panes="isLayoutSwapped = !isLayoutSwapped"
        @toggle-box-mode="isBoxSelecting = !isBoxSelecting" @toggle-bg-image="showBackgroundImage = !showBackgroundImage"
        
        @swap-colors="swapColors" 
        @invert-color="invertColor"
        @open-color-picker="openColorPicker"
        @show-timelapse="showTimelapseModal = true"
        @show-privacy="showPrivacyModal = true"
        />

        <div class="modal-backdrop" v-if="showColorPickerModal" @click.self="showColorPickerModal = false">
            <div class="modal-window" style="width: 500px;"> <div class="studio-header">
                <h2>🎨 Pick Color ({{ colorPickerTarget === 'main' ? 'Main' : 'Sub' }})</h2>
                <button class="close-btn" @click="showColorPickerModal = false">✕</button>
            </div>
            <div style="padding: 20px;">
                <div class="preset-grid">
                    <button v-for="c in presetColors" :key="c" 
                            class="preset-btn-large" 
                            :style="{ backgroundColor: c }" 
                            @click="applyColorFromModal(c)">
                    </button>
                </div>
                <div style="margin-top: 20px; border-top: 2px dashed #eee; padding-top: 20px;">
                    <label class="custom-color-label">Custom Hex Code</label>
                    <div class="custom-color-input-group">
                        <input type="color" class="custom-picker"
                               :value="colorPickerTarget === 'main' ? aaTextColor : subTextColor" 
                               @input="applyColorFromModal(($event.target as HTMLInputElement).value, false)">
                        <input type="text" class="custom-hex"
                               :value="colorPickerTarget === 'main' ? aaTextColor : subTextColor"
                               readonly>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <AaPrivacyModal :is-visible="showPrivacyModal" @close="showPrivacyModal = false" />
    <AaGridOverlay :is-active="showGrid" :project-a-as="projectAAs" :current-index="currentAAIndex"
      @close="showGrid = false" @select="idx => { currentAAIndex = idx; showGrid = false; }" @add="addNewPage" @delete="deletePage" />

    <AaReferenceWindow :is-visible="refWindowVisible" :title="refContent.title" :content="refContent.content" @close="refWindowVisible = false" />

    <AaExportModal 
      :is-visible="showExportImageModal"
      :aa-content="aaOutput"
      :font-stack="fontStack"
      :default-text-color="aaTextColor"
      @close="showExportImageModal = false"
    />

    <AaTimelapseModal 
        :is-visible="showTimelapseModal"
        :history-stack="project.historyStack.value"
        :font-stack="fontStack"
        @close="showTimelapseModal = false"
    />
    <AaHelpModal :is-visible="showHelpModal" @close="showHelpModal = false" />
    <div class="modal-backdrop" v-if="showPaletteEditor" @click.self="showPaletteEditor = false">
        <div class="modal-window" style="width: 700px; height: 500px; display:flex; flex-direction:column;">
            <div class="studio-header"><h2>✏️ Edit Palette</h2><button class="close-btn" @click="showPaletteEditor = false">✕</button></div>
            <div style="flex:1; display:flex; overflow:hidden;">
                <div style="width:220px; border-right:1px solid #ddd; display:flex; flex-direction:column; background:#f9f9f9;">
                    <div style="padding:10px; border-bottom:1px solid #ddd;"><button class="studio-btn primary w-100" @click="addCategory">+ New Category</button></div>
                    <div style="flex:1; overflow-y:auto;">
                        <div v-for="(cat, idx) in categories" :key="cat.id" class="palette-list-item" :class="{ active: editingCatId === cat.id }" @click="editingCatId = cat.id">
                            <span class="cat-name">{{ cat.name }}</span>
                            <div class="cat-actions" v-if="editingCatId === cat.id">
                                <button @click.stop="moveCategory(idx, -1)" :disabled="idx===0">↑</button>
                                <button @click.stop="moveCategory(idx, 1)" :disabled="idx===categories.length-1">↓</button>
                                <button @click.stop="removeCategory(cat.id)" class="del">×</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="flex:1; display:flex; flex-direction:column; padding:20px;" v-if="editingCategory">
                    <div class="control-group"><label>Category Name</label><input type="text" v-model="editingCategory.name" @change="savePaletteToStorage" class="full-input"></div>
                    <div class="control-group" style="flex:1; display:flex; flex-direction:column;">
                        <label>Characters</label>
                        <textarea v-model="editingCategory.chars" @change="savePaletteToStorage" class="config-textarea" style="flex:1; font-size:16px;"></textarea>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" v-if="showConfigModal" @click.self="showConfigModal = false">
        <div class="modal-window config-window">
            <div class="studio-header"><h2>{{ t('cfg_title') }}</h2><button class="close-btn" @click="showConfigModal = false">✕</button></div>
            <div class="settings-pane">
                <div class="config-section">
                    <h3>{{ t('cfg_lang') }}</h3>
                    <div class="btn-group">
                        <button class="studio-btn outline" :class="{ active: currentLang === 'ja' }" @click="currentLang = 'ja'">🇯🇵 日本語</button>
                        <button class="studio-btn outline" :class="{ active: currentLang === 'en' }" @click="currentLang = 'en'">🇺🇸 English</button>
                    </div>
                </div>
                <div class="config-section"><h3>{{ t('cfg_allowed') }}</h3><textarea v-model="ai.config.value.allowedChars" @change="onConfigUpdate" class="config-textarea" style="height:60px;"></textarea></div>
                <div class="config-section">
                    <h3>{{ t('cfg_font') }}</h3>
                    <div class="control-row"><span class="control-label">Current: <b>{{ ai.customFontName.value }}</b></span><label class="studio-btn outline small">Change<input type="file" @change="onFontFileChange" accept=".ttf" hidden></label></div>
                </div>
                <div class="config-section">
                    <h3>{{ t('cfg_advanced') }}</h3>
                    <label class="check-row"><input type="checkbox" v-model="ai.config.value.safeMode" @change="toggleSafeMode"><span>{{ t('cfg_safe_mode') }}</span></label>
                    <label class="check-row"><input type="checkbox" v-model="ai.config.value.useThinSpace"><span>{{ t('cfg_thin_space') }}</span></label>
                    
                    <label class="check-row">
                        <input type="checkbox" v-model="ai.config.value.bbsMode">
                        <span>{{ t('cfg_bbs_mode') }}</span>
                    </label>
                    <p class="config-desc">Highlights leading spaces, consecutive spaces, and anchors.</p>
                </div>
            </div>
            <div class="config-section">
              <h3>{{ t('cfg_reset_title') }}</h3>
              <button class="studio-btn outline w-100" @click="handleResetAiConfig">
                  {{ t('cfg_reset_btn') }}
              </button>
          </div>
        </div>
    </div>
    <AaAboutModal :is-visible="showAboutModal" @close="showAboutModal = false" />

    <div class="toast-notification" :class="{ active: project.showToast.value }">{{ project.toastMessage.value }}</div>
    <input id="fileInput" type="file" hidden @change="project.onLoadFile(($event.target as HTMLInputElement).files![0]!)" accept=".txt,.mlt,.ast">
    <Transition name="fade-overlay">
      <div v-if="!ai.isReady.value" class="splash-overlay">
        <div class="splash-content">
          <div class="loading-spinner"></div>
          <h2 class="splash-title">{{ t('app_title') }}</h2>
          <div class="splash-status">
            <span class="status-icon">⚙️</span>
            <span>{{ ai.status.value }}</span>
          </div>
          <div class="splash-tips">
            Initialize AI Models & Vector Database...<br>
            Please wait a moment.
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="fade">
      <div v-if="ai.isProcessing.value" class="processing-indicator">
        <span class="spinner-small"></span>
        Processing Image...
      </div>
    </Transition>
  <Transition name="fade">
        <div v-if="isDragOver" class="drop-overlay">
            <div class="drop-message">
                <div class="drop-icon">📂</div>
                <h2>Drop Image Here</h2>
                <p>Release to load image</p>
            </div>
        </div>
    </Transition>
  </div>
</template>

<style>
/* --- Fonts & Global Variables --- */
@font-face {
    font-family: 'MSP_Parallel';
    src: local('MS PGothic'), local('MS Pゴシック');
    unicode-range: U+2225;
}
@font-face {
    font-family: 'Saitamaar';
    src: url('/Saitamaar.ttf') format('truetype');
    font-display: swap;
}

:root {
    --bg-app: #Fdfbf7;
    --bg-panel: #ffffff;
    --text-main: #5c554f;
    --text-sub: #948c85;
    --accent-primary: #e6b086;
    --border-soft: 1px solid rgba(92, 85, 79, 0.1);
    --font-ui: "M PLUS Rounded 1c", "Hiragino Maru Gothic Pro", "Rounded Mplus 1c", sans-serif;
}

* { box-sizing: border-box; }
body { margin: 0; height: 100vh; background-color: var(--bg-app); color: var(--text-main); font-family: var(--font-ui); overflow: hidden; }

/* --- App Layout Structure --- */
.app-root { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; }
.workspace { flex: 1; min-height: 0; padding: 0; display: grid; grid-template-columns: 1fr 260px; gap: 0; overflow: hidden; }

/* Header & Footer Layout (Detail styles are in components) */
.app-header { flex: 0 0 50px; z-index: 50; }
.app-footer { flex: 0 0 35px; z-index: 50; }

/* --- Sidebar Structure (Fixed Tabs + Scrollable Content) --- */
.sidebar {
    display: flex;
    flex-direction: column;
    background: #fdfdfd;
    height: 100%;
    position: relative; /* For Overlay */
    overflow: hidden;
    border-left: var(--border-soft);
}

.sidebar-tabs {
    flex: 0 0 auto;
    display: flex;
    border-bottom: 1px solid #ddd;
}

.sidebar-tabs button {
    flex: 1; padding: 10px;
    font-weight: bold; font-size: 0.85rem; color: #888;
    border: none; border-bottom: 2px solid transparent;
    background: transparent; cursor: pointer;
}

.sidebar-tabs button.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
    background: #fff;
}

/* Sidebar Scroll Logic */
.sidebar-scroll-container {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* Default: Palette handles its own scroll */
}

.sidebar-scroll-container.scroll-y {
    overflow-y: auto; /* Image Panel: Scroll here */
    overflow-x: hidden;
    display: block;
}
/* Custom Scrollbar */
.sidebar-scroll-container::-webkit-scrollbar { width: 6px; }
.sidebar-scroll-container::-webkit-scrollbar-thumb { background-color: #ccc; border-radius: 3px; }

/* --- Loading Overlays & Indicators --- */

/* 1. Splash Screen (App Init) */
.splash-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: var(--bg-app);
    z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column;
}
.splash-content { text-align: center; animation: fadeIn 0.5s ease-out; }
.splash-title { font-size: 2rem; color: var(--text-main); margin-bottom: 20px; font-weight: bold; letter-spacing: 1px; }
.splash-status { display: flex; align-items: center; justify-content: center; gap: 10px; font-family: monospace; font-size: 1.1rem; color: #666; margin-bottom: 10px; }
.splash-tips { font-size: 0.85rem; color: #999; line-height: 1.5; }

.loading-spinner {
    width: 50px; height: 50px; border: 4px solid #eee;
    border-top-color: var(--accent-primary); border-radius: 50%;
    animation: spin 1s linear infinite; margin: 0 auto 20px;
}

/* 2. Global Processing Indicator (Bottom Right) */
.processing-indicator {
    position: fixed; bottom: 50px; right: 20px;
    background: rgba(0,0,0,0.85); color: white;
    padding: 10px 20px; border-radius: 30px;
    display: flex; align-items: center; gap: 10px;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    z-index: 99999; /* Always on top */
    font-size: 0.9rem; pointer-events: none;
}
.spinner-small {
    width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white; border-radius: 50%;
    animation: spin 1s linear infinite;
}

/* 3. Sidebar Overlay (Line Art Extraction) */
.sidebar-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(2px);
    z-index: 100;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.sidebar-spinner {
    width: 32px; height: 32px; border: 3px solid #eee; border-top-color: var(--accent-primary);
    border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 8px;
}
.sidebar-overlay-text { font-weight: bold; color: #666; font-size: 0.9rem; }

/* --- Modals & Popups --- */
.modal-backdrop {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);
    z-index: 300;
    display: flex; align-items: center; justify-content: center;
}
.modal-window {
    background: #fff; border-radius: 8px;
    display: flex; flex-direction: column;
    overflow: hidden; max-height: 90vh;
    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
}
.studio-header {
    padding: 10px 15px; background: #f9f9f9; border-bottom: 1px solid #eee;
    display: flex; justify-content: space-between; align-items: center;
}
.studio-header h2 { margin: 0; font-size: 1rem; color: #444; }
.close-btn { font-size: 1.2rem; color: #999; border: none; background: none; cursor: pointer; }
.close-btn:hover { color: #333; }
.settings-pane { padding: 15px; overflow-y: auto; }

/* Config Components */
.config-section { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #eee; }
.config-section h3 { font-size: 0.9rem; margin: 0 0 10px 0; color: #555; }
.config-textarea { width: 100%; border: 1px solid #ccc; border-radius: 4px; padding: 5px; font-family: monospace; font-size: 0.8rem; resize: vertical; }
.check-row { display: flex; align-items: center; margin-bottom: 8px; cursor: pointer; }
.check-row input { margin-right: 8px; }
.check-row span { font-weight: bold; font-size: 0.85rem; }
.config-desc { margin: 0 0 0 24px; font-size: 0.75rem; color: #888; }

/* --- Color Picker Modal Styles --- */
.preset-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px;
    margin-bottom: 15px;
}
.preset-btn-large {
    width: 32px; height: 32px;
    border: 2px solid rgba(0,0,0,0.1);
    border-radius: 6px;
    cursor: pointer; padding: 0;
    transition: all 0.15s ease-out;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.preset-btn-large:hover {
    transform: scale(1.15);
    border-color: var(--accent-primary);
    z-index: 10;
    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}
.custom-color-label { display: block; margin-bottom: 8px; font-weight: bold; font-size: 0.9rem; color: #555; }
.custom-color-input-group {
    display: flex; gap: 10px; align-items: center;
    background: #f9f9f9; padding: 8px; border-radius: 8px; border: 1px solid #eee;
}
input[type="color"].custom-picker {
    flex: 1; height: 36px; cursor: pointer; border: none; padding: 0; background: none;
    border-radius: 4px;
}
input[type="text"].custom-hex {
    width: 90px; text-align: center; border: 1px solid #ddd; border-radius: 4px;
    padding: 8px; font-family: monospace; font-weight: bold; color: #444;
}

/* --- Common UI Components --- */
.control-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.control-label { font-size: 0.8rem; color: #555; }
.studio-btn { padding: 6px 12px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; cursor: pointer; border: 1px solid transparent; transition: 0.2s; }
.studio-btn.primary { background: var(--accent-primary); color: #fff; }
.studio-btn.primary:hover { background: #d49a6a; }
.studio-btn.outline { border-color: #ccc; background: #fff; color: #333; }
.studio-btn.outline:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
.w-100 { width: 100%; }

/* --- Palette Editor Styles --- */
.palette-list-item { padding: 8px 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; }
.palette-list-item:hover { background: #f0f0f0; }
.palette-list-item.active { background: var(--accent-primary); color: #fff; font-weight: bold; }
.cat-actions button { background: rgba(255,255,255,0.2); border: none; border-radius: 3px; color: #fff; cursor: pointer; padding: 2px 6px; font-size: 0.7rem; margin-left: 2px; }
.cat-actions button:hover { background: rgba(255,255,255,0.4); }
.cat-actions button.del:hover { background: red; }
.full-input { width: 100%; border: 1px solid #ddd; padding: 6px; border-radius: 4px; }

/* --- Toast Notification --- */
.toast-notification {
    position: fixed; bottom: 50px; left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: rgba(0, 0, 0, 0.8); color: white;
    padding: 8px 16px; border-radius: 4px;
    font-size: 0.85rem; font-weight: bold;
    opacity: 0; pointer-events: none;
    transition: 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    z-index: 1000;
}
.toast-notification.active { opacity: 1; transform: translateX(-50%) translateY(0); }

/* --- Box Selection Styles --- */
textarea.aa-textarea.box-mode-active { caret-color: transparent !important; }
textarea.aa-textarea.box-mode-active::selection { background-color: transparent !important; color: inherit !important; }
.box-overlay-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5; }
.box-selection-line { position: absolute; background-color: rgba(0, 100, 255, 0.2); }

/* --- Transitions --- */
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.fade-overlay-enter-active, .fade-overlay-leave-active { transition: opacity 0.6s ease; }
.fade-overlay-enter-from, .fade-overlay-leave-to { opacity: 0; }
.drop-overlay {
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(230, 176, 134, 0.9); /* アプリのテーマカラー(accent-primary)に合わせる */
    z-index: 99999; /* 最前面 */
    display: flex; align-items: center; justify-content: center;
    pointer-events: none; /* イベントを透過させない（dropイベントは親で受けるのでOKだが、デザイン上はnoneで良い場合も） */
    /* ただし、@dropは親の.app-rootで受けるため、pointer-events: noneにしておくと
       オーバーレイの下にある要素が反応してしまう可能性がある。
       今回は .app-root で受けるので、オーバーレイ自体がイベントをブロックしないように none にするか、
       あるいはオーバーレイ自体に @drop をつける手もある。
       
       一番確実なのは、オーバーレイ自体は pointer-events: none にして、
       .app-root で drop を受け取る構成です。
    */
}

.drop-message {
    text-align: center;
    color: white;
    background: rgba(255, 255, 255, 0.2);
    padding: 40px;
    border-radius: 16px;
    border: 4px dashed white;
    animation: pulse 1.5s infinite;
}

.drop-icon { font-size: 4rem; margin-bottom: 10px; }
.drop-message h2 { margin: 0; font-size: 2rem; }
.drop-message p { margin: 10px 0 0; font-size: 1.2rem; opacity: 0.9; }

@keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
}
</style>