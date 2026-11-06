/**
 * 宠物视图组件（T5 / B2）
 * - 挂在 Main.scene 的 PetAnchor 节点上（运行时由 SceneSetup 挂载）
 * - 按主宠当前阶段加载 resources 模型；无主宠但有孵化中的蛋时显示蛋模型
 * - 模型缺失时用内置几何体占位，保证任何情况下场景里都有东西
 * - 动画：优先播放模型自带同名动画剪辑，缺失时用缩放/位移补间占位
 *   （呼吸=轻微缩放、开心=跳跃、失落=趴下变小）
 */

import {
  _decorator, builtinResMgr, Component, EffectAsset, Material, MeshRenderer, Node,
  Tween, tween, Vec3, resources, Color, Mesh, Texture2D,
} from 'cc';
import { Behavior, Stage } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { GameSave } from '../core/GameSave';
import { PetBehavior } from '../pet/PetBehavior';
import { Collection } from '../collection/Collection';
import { getSpecies } from '../pet/PetDefs';
import { PetViewModel } from '../pet/PetViewModel';

const { ccclass } = _decorator;

/** Mesh 子资源路径：resources/<id>/<id>_<stage>.glb → <id>/<id>_<stage>/node_0（cc.Mesh） */
export function petMeshKey(path: string): string {
  const base = path
    .replace(/^resources\//, '')
    .replace(/\.(glb|fbx|obj|prefab)$/i, '');
  const segs = base.split('/');
  segs[segs.length - 1] = 'node_0';
  return segs.join('/');
}

/**
 * 纯色材质（不引用任何贴图）。
 * 注意：真机上 EffectAsset.get('builtin-standard') 可能为 null（内建 effect 未注册），
 * 此时 Material.passes 长度为 0，赋给 MeshRenderer 会触发原生空指针（setSubModelMaterial）。
 * 因此按候选 effect 依次尝试，且 passes 必须 > 0 才返回。
 *
 * Creator 3.8.x 各 effect 的主颜色属性名不完全一致：
 *   builtin-unlit:       mainColor (color)
 *   builtin-standard:    albedo   (color)
 *   builtin-phong:       diffuse  (color) / albedoMap (texture)
 * 这里用 setProperty 遍历三个候选属性，只要有一个生效即可。
 */
export function makePlainMaterial(hex: string): Material | null {
  const CANDIDATES = ['builtin-unlit', 'builtin-standard', 'builtin-phong'];
  const COLOR_PROPS = ['mainColor', 'albedo', 'baseColor', 'diffuse'];
  for (const name of CANDIDATES) {
    try {
      if (!EffectAsset.get(name)) continue;
      const mat = new Material();
      mat.initialize({ effectName: name });
      if (mat.passes.length === 0) continue;
      const c = new Color();
      Color.fromHEX(c, hex);
      let applied = false;
      for (const prop of COLOR_PROPS) {
        try {
          mat.setProperty(prop, c);
          applied = true;
        } catch (_) { /* ignore unknown property */ }
      }
      // unlit 需要关掉顶点色覆盖，避免模型自带顶点色把颜色冲掉
      try { mat.setProperty('useVertexColor', 0); } catch (_) { /* no-op */ }
      if (!applied) {
        console.warn('[PetView] effect', name, '没有匹配到颜色属性，passes=', mat.passes.length);
        continue;
      }
      console.log('[PetView] makePlainMaterial →', name, 'color=', hex, 'passes=', mat.passes.length);
      return mat;
    } catch (e) {
      console.warn('[PetView] 材质初始化失败:', name, e);
    }
  }
  console.warn('[PetView] 无可用内建 effect，保留渲染器默认材质');
  return null;
}

/**
 * 模型的 albedo 贴图路径（T30）。
 * 美术 GLB 内嵌贴图是 4096² × 3 张（albedo / normal / metallic-roughness），
 * 直接加载在低端机（Mali-T820）会 GL_OUT_OF_MEMORY；但只用纯色又会让宠物变成
 * 一块没有五官的色块（用户反馈「只有一个轮廓」）。
 * 折中：构建期把 albedo 降采样到 1024² 单独放进 resources，
 * 运行时只加载这一张贴图 → 既保住五官/花纹，显存也只有约 1.4MB。
 *
 *   models/mao_tuantuan/mao_tuantuan_baby.glb
 *     → models/mao_tuantuan/baby_albedo
 */
export function petAlbedoPath(modelPath: string): string {
  // 模型路径约定：resources/models/<id>/<id>_<stage>/<id>_<stage>.glb
  // 贴图和模型同放在 <id> 目录下：models/<id>/<stage>_albedo（不带 resources/ 前缀，
  // resources.load 的 key 不含 bundle 名）。
  const m = /^resources\/(.*\/)[^/]+_(egg|baby|adult|final)\/[^/]+\.(?:glb|fbx|obj|prefab)$/i.exec(modelPath);
  if (!m) return '';
  return `${m[1]}${m[2].toLowerCase()}_albedo`;
}

/** 贴图缓存：同一模型被反复加载（切阶段、卡片人像）时不重复解码 */
const _albedoCache = new Map<string, Texture2D>();

/** 加载宠物 albedo（失败/缺失时回调 null，调用方退回纯色材质） */
export function loadPetAlbedo(modelPath: string, cb: (tex: Texture2D | null) => void): void {
  const key = petAlbedoPath(modelPath);
  if (!key) { cb(null); return; }
  const hit = _albedoCache.get(key);
  if (hit && hit.isValid) { cb(hit); return; }
  // PNG 导入后是 ImageAsset + Texture2D 两个子资源，Texture2D 的子资源名固定为 texture
  resources.load(`${key}/texture`, Texture2D, (err, tex) => {
    if (err || !tex) {
      console.warn('[PetView] albedo 缺失，退回纯色:', `${key}/texture`, err);
      cb(null);
      return;
    }
    _albedoCache.set(key, tex);
    cb(tex);
  });
}

/**
 * 宠物材质：有 albedo 就用「unlit + 贴图」（保留美术画好的眼睛/花纹/体积感），
 * 没有就退回纯色 unlit（至少不是白模）。
 * 用 unlit 而不是 standard：美术贴图自带明暗与高光，走光照反而会二次压暗，
 * 且卡片人像用独立渲染纹理，unlit 不受主光方向影响，画面更可控。
 */
export function makePetMaterial(hex: string, tex?: Texture2D | null): Material | null {
  if (tex && tex.isValid) {
    try {
      const mat = new Material();
      mat.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: true } });
      if (mat.passes.length > 0) {
        mat.setProperty('mainTexture', tex);
        mat.setProperty('mainColor', new Color(255, 255, 255, 255));
        try { mat.setProperty('useVertexColor', 0); } catch (_) { /* no-op */ }
        return mat;
      }
      console.warn('[PetView] 贴图材质 pass 为空，退回纯色');
    } catch (e) {
      console.warn('[PetView] 贴图材质初始化失败:', e);
    }
  }
  return makePlainMaterial(hex);
}

/**
 * 美术模型的导出朝向（T30 修正）。
 * 4 个阶段的 GLB 都是「躺姿」导出的：身体沿 -Z 铺开，脸朝 +Y，
 * 包围盒 Y 只有 0.8~1.1、Z 有 0.76~1.05 —— 直接放进场景就是一只躺着的宠物，
 * 侧看只剩一团轮廓（用户反馈「只有一个轮廓」）。
 * 绕 X 轴 +90° 后：局部 -Z 变世界 +Y（站起来），脸朝 +Z（正对主相机），
 * 同时与 WanderSystem.faceTarget 的「0° = 朝 +Z」约定一致，走动时不再倒着走。
 */
const UPRIGHT_X = 90;

/** 站立姿态下的垂直尺寸与脚底偏移（绕 X +90° 后，局部 z 变成世界 y） */
export function uprightMetrics(mesh: Mesh): { height: number; foot: number } {
  const st = mesh?.struct;
  if (!st?.minPosition || !st?.maxPosition) return { height: 0, foot: 0 };
  const minZ = st.minPosition.z;
  const maxZ = st.maxPosition.z;
  return { height: maxZ - minZ, foot: maxZ };
}

/** 模型目标高度（世界单位），按阶段微调（卡片人像也用同一套，见 PetPortrait） */
export const PET_TARGET_HEIGHT: Record<Stage, number> = {
  [Stage.Egg]: 0.75,
  [Stage.Baby]: 0.85,
  [Stage.Adult]: 1.15,
  [Stage.Final]: 1.3,
};

/** 拖动/落点临时反应类型（T22） */
export type PetReaction =
  | 'lift' | 'follow' | 'drop'
  | 'satisfy' | 'excited' | 'play'
  | 'sad' | 'celebrate';

@ccclass('PetView')
export class PetView extends Component {

  private _model: Node | null = null;
  /** 模型外层容器（只负责把朝向转正，不让动画把它冲掉） */
  private _holder: Node | null = null;
  private _loadKey = '';
  private _baseScale = new Vec3(1, 1, 1);
  private _baseY = 0;
  private _themeColor: Color = new Color(217, 160, 102, 255);
  private _stage: Stage = Stage.Egg;
  private _dev = false;
  private _lastDevLog = 0;

  onLoad(): void {
    this._dev = typeof location !== 'undefined' && /[?&]dev=1/.test(location.search);
    Events.on(EventName.ActivePetSwitched, this.onRefresh);
    Events.on(EventName.PetStageChanged, this.onRefresh);
    Events.on(EventName.PetCollected, this.onRefresh);
    Events.on(EventName.EggAdded, this.onRefresh);
    Events.on(EventName.EggIncubationStarted, this.onRefresh);
    Events.on(EventName.EggBrokenShell, this.onRefresh);
    Events.on(EventName.PetBehaviorChanged, this.onBehaviorChanged);
    this.scheduleOnce(this.onRefresh, 0);
  }

  update(dt: number): void {
    if (!this._dev) return;
    const now = Date.now();
    if (now - this._lastDevLog < 2000) return;
    this._lastDevLog = now;
    const wp = this.node.worldPosition;
    const scale = this.node.scale;
    const path = this._loadKey;
    let passes = 0;
    let effectName = '';
    let matColor = '';
    if (this._model) {
      const r = this._model.getComponentInChildren(MeshRenderer);
      const m = r?.material as Material | null | undefined;
      passes = m?.passes?.length ?? 0;
      try { effectName = m?.effectAsset?.name ?? ''; } catch (_) { /* ignore */ }
      const c = this._themeColor;
      matColor = `rgb(${c.r},${c.g},${c.b})`;
    }
    console.log(`[PetView:dev] stage=${this._stage} wp=(${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)}) scale=(${scale.x.toFixed(2)},${scale.y.toFixed(2)},${scale.z.toFixed(2)}) baseY=${this._baseY.toFixed(2)} model=${!!this._model} mat=${effectName} passes=${passes} color=${matColor} mesh=${path}`);
  }

  onDestroy(): void {
    Events.off(EventName.ActivePetSwitched, this.onRefresh);
    Events.off(EventName.PetStageChanged, this.onRefresh);
    Events.off(EventName.PetCollected, this.onRefresh);
    Events.off(EventName.EggAdded, this.onRefresh);
    Events.off(EventName.EggIncubationStarted, this.onRefresh);
    Events.off(EventName.EggBrokenShell, this.onRefresh);
    Events.off(EventName.PetBehaviorChanged, this.onBehaviorChanged);
    this.clearModel();
  }

  /** 外部（UI 命中测试）用：宠物节点的世界坐标 */
  get displayWorldPos(): Vec3 {
    return this.node.worldPosition.clone();
  }

  /** 当前是否在展示蛋（UI 用于判断长按蛋加速） */
  get showingEgg(): boolean {
    return this._stage === Stage.Egg;
  }

  /**
   * 3D 模型显隐（T25 修正）。
   * 蛋阶段由 UI 的 2D 灵卵叠加层负责画面，3D 灰模会从 2D 灵卵后面露出一个灰色半圆
   * （看上去就像蛋背后多了一块阴影），所以叠加层出现时必须把 3D 模型藏掉。
   */
  setModelVisible(visible: boolean): void {
    if (this._modelVisible === visible) return;
    this._modelVisible = visible;
    this.applyModelVisibility();
  }

  private _modelVisible = true;

  private applyModelVisibility(): void {
    if (this._model) this._model.active = this._modelVisible;
  }

  /** 行为标签变化 → 只换动画，不重载模型（T6） */
  private onBehaviorChanged = (petId: unknown, behavior: unknown): void => {
    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!pet || pet.id !== petId) return;
    if (this._stage === Stage.Egg) return;
    this.playBehavior(behavior as Behavior);
  };

  // ===== 刷新显示 =====

  private onRefresh = (): void => {
    const save = GameSave.data;
    if (!save) return;

    const pet = Collection.getActivePet(save);
    this._stage = pet ? pet.stage : Stage.Egg;

    let path = '';
    let themeHex = '#D9A066';
    if (pet) {
      path = PetViewModel.modelPath(pet);
      themeHex = getSpecies(pet.speciesId)?.themeColor ?? themeHex;
    } else {
      const egg = save.eggs.find(e => e.incubating && e.hatchesAt > 0);
      const def = egg ? getSpecies(egg.speciesId) : undefined;
      path = def?.models?.[Stage.Egg] ?? '';
      themeHex = def?.themeColor ?? themeHex;
    }

    if (!path) {
      this.clearModel();
      return;
    }
    if (path === this._loadKey) {
      this.applyBehavior();
      return;
    }
    this.loadModel(path, themeHex);
  };

  /** 只加载模型的 Mesh 子资源，材质自建纯色/贴图。
   * 原因：美术 GLB 内嵌 3 张 4096×4096 贴图，真机（Mali-T820）上传时 GL_OUT_OF_MEMORY 直接 SIGSEGV；
   * 这里只取 Mesh，材质自己拼（albedo 用构建期降采样的 1024² 版本，见 petAlbedoPath）。
   */
  private loadModel(path: string, themeHex: string): void {
    const key = petMeshKey(path);
    this._loadKey = path;
    Color.fromHEX(this._themeColor, themeHex);
    resources.load(key, Mesh, (err, mesh) => {
      if (this._loadKey !== path) return; // 期间已切换
      if (err || !mesh) {
        console.warn('[PetView] 模型加载失败，使用几何占位:', key, err);
        this.buildFallback();
        return;
      }
      this.clearModel();
      // 美术模型是躺姿导出的，见 UPRIGHT_X：用一层 PetStand 承担 +90° 的基准旋转，
      // 动画仍然跑在无旋转的 holder 上（否则位移/缩放会被旋转坐标系带偏）。
      const holder = new Node('PetModelHolder');
      holder.setParent(this.node);
      const stand = new Node('PetStand');
      stand.setParent(holder);
      stand.setRotationFromEuler(UPRIGHT_X, 0, 0);
      const node = new Node('PetModel');
      node.setParent(stand);
      const mr = node.addComponent(MeshRenderer);
      mr.mesh = mesh;
      const mat = makePlainMaterial(themeHex);
      if (mat) {
        // 覆盖所有 subMesh 材质（GLB 内嵌的 materials 数组可能有多元素，mr.material 只替换 index 0）
        const count = (mr.materials?.length ?? 0) || 1;
        const allMat = new Array(count).fill(mat);
        mr.materials = allMat;
      }
      this._model = holder;
      this._holder = holder;
      this.applyModelVisibility();
      this.fitModel(holder, mesh, PET_TARGET_HEIGHT[this._stage]);
      this.applyBehavior();

      // 贴图是异步的：先上纯色（避免白模），到了再换，玩家几乎看不出中间态
      loadPetAlbedo(path, (tex) => {
        if (!tex || this._model !== holder || !node.isValid) return;
        const texMat = makePetMaterial(themeHex, tex);
        if (!texMat) return;
        const count = (mr.materials?.length ?? 0) || 1;
        mr.materials = new Array(count).fill(texMat);
      });
    });
  }

  /**
   * 按 Mesh 包围盒归一化高度，并把脚底对齐到 y=0。
   * 注意模型是躺姿（见 UPRIGHT_X），垂直尺寸取的是局部 Z 跨度；
   * 绕 X +90° 后世界 y = -z，所以脚底偏移是 maxZ（不是 -minY）。
   */
  private fitModel(node: Node, mesh: Mesh, targetHeight: number): void {
    const { height, foot } = uprightMetrics(mesh);
    if (height < 0.001) {
      this._baseScale = new Vec3(1, 1, 1);
      this._baseY = 0;
      return;
    }
    const scale = targetHeight / height;
    node.setScale(scale, scale, scale);
    const y = foot * scale;
    node.setPosition(0, y, 0);
    this._baseScale = new Vec3(scale, scale, scale);
    this._baseY = y;
  }

  /** 模型资源缺失时的几何占位（黑盒子里不至于空无一物） */
  private buildFallback(): void {
    this.clearModel();
    const node = new Node('FallbackModel');
    node.setParent(this.node);
    const s = this._stage === Stage.Egg ? 0.6 : 1.0;
    node.setScale(s, s, s);
    const mr = node.addComponent(MeshRenderer);
    try {
      const mesh = builtinResMgr.get<Mesh>('box');
      if (mesh) mr.mesh = mesh;
    } catch (e) {
      console.warn('[PetView] 占位几何创建失败:', e);
    }
    const fbMat = makePlainMaterial('#D9A066');
    if (fbMat) mr.material = fbMat;
    Color.fromHEX(this._themeColor, '#D9A066');
    this._model = node;
    this.applyModelVisibility();
    this._baseScale = new Vec3(s, s, s);
    this._baseY = 0;
    this.applyBehavior();
  }

  private clearModel(): void {
    if (this._model) {
      Tween.stopAllByTarget(this._model);
      this._model.destroy();
      this._model = null;
    }
    if (this._holder && this._holder.isValid) {
      this._holder.destroy();
    }
    this._holder = null;
  }

  // ===== 占位动画 =====

  private applyBehavior(): void {
    const model = this._model;
    if (!model) return;
    Tween.stopAllByTarget(model);
    model.setScale(this._baseScale);
    model.setPosition(0, this._baseY, 0);

    if (this._stage === Stage.Egg) {
      // 蛋：轻微呼吸 + 摇摆
      const s = this._baseScale;
      tween(model)
        .to(1.4, { scale: new Vec3(s.x * 1.03, s.y * 0.98, s.z * 1.03) })
        .to(1.4, { scale: s.clone() })
        .union()
        .repeatForever()
        .start();
      return;
    }

    const save = GameSave.data;
    const pet = save ? Collection.getActivePet(save) : undefined;
    if (!save || !pet) return;
    const behavior = PetBehavior.evaluate(PetBehavior.computeInput(save, pet));
    this.playBehavior(behavior);
  }

  /** 行为 → 占位动画（有同名剪辑时优先播放剪辑） */
  private playBehavior(behavior: Behavior): void {
    const model = this._model;
    if (!model) return;
    Tween.stopAllByTarget(model);
    const s = this._baseScale;
    model.setScale(s);
    model.setPosition(0, this._baseY, 0);
    if (behavior !== Behavior.Sad) this.tint(model, this._themeColor);
    if (behavior === Behavior.Happy) {
      tween(model)
        .by(0.16, { position: new Vec3(0, 0.22, 0) })
        .by(0.16, { position: new Vec3(0, -0.22, 0) })
        .delay(0.4)
        .union()
        .repeatForever()
        .start();
      return;
    }
    if (behavior === Behavior.Sad) {
      // 失落可视化（T16）：缩身 + 变灰 + 缓慢叹气起伏
      model.setScale(s.x * 0.86, s.y * 0.86, s.z * 0.86);
      this.tint(model, new Color(150, 150, 150, 255));
      tween(model)
        .to(1.8, { position: new Vec3(0, this._baseY - 0.12, 0) })
        .to(1.8, { position: new Vec3(0, this._baseY - 0.05, 0) })
        .union()
        .repeatForever()
        .start();
      return;
    }
    if (behavior === Behavior.Expect) {
      // 抬头等你：上下轻微起伏
      tween(model)
        .to(1.0, { position: new Vec3(0, this._baseY + 0.05, 0) })
        .to(1.0, { position: new Vec3(0, this._baseY, 0) })
        .union()
        .repeatForever()
        .start();
      return;
    }
    // Calm：呼吸
    tween(model)
      .to(1.6, { scale: new Vec3(s.x * 1.04, s.y * 1.02, s.z * 1.04) })
      .to(1.6, { scale: s.clone() })
      .union()
      .repeatForever()
      .start();
  }

  // ===== 拖动/落点临时反应（T22）=====

  /** 播放一段临时反应，结束后自动回到行为动画 */
  playReaction(kind: PetReaction, duration: number = 0.9): void {
    const model = this._model;
    if (!model) return;
    Tween.stopAllByTarget(model);
    model.setScale(this._baseScale);
    model.setPosition(0, this._baseY, 0);
    model.setRotationFromEuler(0, 0, 0);
    this.tint(model, this._themeColor);
    const s = this._baseScale;
    let hold = duration;

    switch (kind) {
      case 'lift':
        tween(model)
          .to(0.12, { scale: new Vec3(s.x * 1.1, s.y * 1.06, s.z * 1.1), eulerAngles: new Vec3(0, 0, 6) })
          .start();
        break;
      case 'follow':
        tween(model)
          .to(0.20, { eulerAngles: new Vec3(0, 0, 5) })
          .to(0.20, { eulerAngles: new Vec3(0, 0, -5) })
          .union()
          .repeatForever()
          .start();
        break;
      case 'drop':
        tween(model)
          .to(0.10, { scale: new Vec3(s.x * 1.18, s.y * 0.78, s.z * 1.18) })
          .to(0.16, { scale: new Vec3(s.x * 0.94, s.y * 1.08, s.z * 0.94) })
          .to(0.14, { scale: s.clone() })
          .start();
        break;
      case 'satisfy':
        tween(model)
          .to(0.5, { scale: new Vec3(s.x * 0.9, s.y * 0.92, s.z * 0.9), eulerAngles: new Vec3(0, 0, -12) })
          .to(0.8, { scale: s.clone(), eulerAngles: new Vec3(0, 0, 0) })
          .start();
        break;
      case 'excited':
        tween(model)
          .by(0.12, { position: new Vec3(0, 0.26, 0) })
          .by(0.12, { position: new Vec3(0, -0.26, 0) })
          .by(0.12, { position: new Vec3(0, 0.26, 0) })
          .by(0.12, { position: new Vec3(0, -0.26, 0) })
          .start();
        break;
      case 'play':
        tween(model)
          .to(0.16, { eulerAngles: new Vec3(0, 0, 22) })
          .to(0.16, { eulerAngles: new Vec3(0, 0, -22) })
          .to(0.16, { eulerAngles: new Vec3(0, 0, 22) })
          .to(0.16, { eulerAngles: new Vec3(0, 0, 0) })
          .start();
        break;
      case 'sad':
        tween(model)
          .to(0.3, { scale: new Vec3(s.x * 0.82, s.y * 0.82, s.z * 0.82), eulerAngles: new Vec3(0, 180, 0) })
          .start();
        hold = Math.max(hold, 1.4);
        break;
      case 'celebrate':
        tween(model)
          .by(0.16, { position: new Vec3(0, 0.5, 0) })
          .by(0.16, { position: new Vec3(0, -0.5, 0) })
          .to(0.3, { eulerAngles: new Vec3(0, 360, 0) })
          .to(0.05, { eulerAngles: new Vec3(0, 0, 0) })
          .start();
        break;
    }

    this.scheduleOnce(() => {
      if (this._model === model) this.applyBehavior();
    }, hold);
  }

  /** 失落变灰：所有 subMesh 全部覆色 */
  private tint(root: Node, color: Color): void {
    for (const r of root.getComponentsInChildren(MeshRenderer)) {
      try {
        const count = r.materials?.length ?? 1;
        for (let i = 0; i < count; i++) {
          const mat = r.materials[i];
          if (!mat) continue;
          try { mat.setProperty('albedo', color); } catch (_) { /* no-op */ }
          try { mat.setProperty('mainColor', color); } catch (_) { /* no-op */ }
          try { mat.setProperty('baseColor', color); } catch (_) { /* no-op */ }
          try { mat.setProperty('diffuse', color); } catch (_) { /* no-op */ }
        }
      } catch (e) { /* ignore */ }
    }
  }
}
