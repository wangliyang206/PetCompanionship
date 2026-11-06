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
  Tween, tween, Vec3, resources, Color, Mesh,
} from 'cc';
import { Behavior, Stage } from '../core/Enums';
import { Events, EventName } from '../core/Events';
import { GameSave } from '../core/GameSave';
import { PetBehavior } from '../pet/PetBehavior';
import { Collection } from '../collection/Collection';
import { getSpecies } from '../pet/PetDefs';
import { PetViewModel } from '../pet/PetViewModel';

const { ccclass } = _decorator;

/**
 * 纯色材质（不引用任何贴图）。
 * 注意：真机上 EffectAsset.get('builtin-standard') 可能为 null（内建 effect 未注册），
 * 此时 Material.passes 长度为 0，赋给 MeshRenderer 会触发原生空指针（setSubModelMaterial）。
 * 因此按候选 effect 依次尝试，且 passes 必须 > 0 才返回。
 */
export function makePlainMaterial(hex: string): Material | null {
  const CANDIDATES = ['builtin-unlit', 'builtin-standard', 'legacy/standard'];
  for (const name of CANDIDATES) {
    try {
      if (!EffectAsset.get(name)) continue;
      const mat = new Material();
      mat.initialize({ effectName: name });
      if (mat.passes.length === 0) continue;
      const c = new Color();
      Color.fromHEX(c, hex);
      mat.setProperty('albedo', c);
      mat.setProperty('mainColor', c);
      mat.setProperty('metallic', 0);
      mat.setProperty('roughness', 0.85);
      return mat;
    } catch (e) {
      console.warn('[PetView] 材质初始化失败:', name, e);
    }
  }
  console.warn('[PetView] 无可用内建 effect，保留渲染器默认材质');
  return null;
}

/** 模型目标高度（世界单位），按阶段微调 */
const TARGET_HEIGHT: Record<Stage, number> = {
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
  private _loadKey = '';
  private _baseScale = new Vec3(1, 1, 1);
  private _baseY = 0;
  private _themeColor: Color = new Color(217, 160, 102, 255);
  private _stage: Stage = Stage.Egg;

  onLoad(): void {
    Events.on(EventName.ActivePetSwitched, this.onRefresh);
    Events.on(EventName.PetStageChanged, this.onRefresh);
    Events.on(EventName.PetCollected, this.onRefresh);
    Events.on(EventName.EggAdded, this.onRefresh);
    Events.on(EventName.EggIncubationStarted, this.onRefresh);
    Events.on(EventName.EggBrokenShell, this.onRefresh);
    Events.on(EventName.PetBehaviorChanged, this.onBehaviorChanged);
    this.scheduleOnce(this.onRefresh, 0);
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

  /**
   * 只加载模型的 Mesh 子资源，材质自建纯色。
   * 原因：美术 GLB 内嵌 3 张 4096×4096 贴图，真机（Mali-T820）上传时 GL_OUT_OF_MEMORY 直接 SIGSEGV；
   * 纯色材质既避开贴图解码/上传，也把首次显示体积降到最低（见 docs/06 D11）。
   */
  private loadModel(path: string, themeHex: string): void {
    const key = this.toMeshKey(path);
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
      const node = new Node('PetModel');
      node.setParent(this.node);
      const mr = node.addComponent(MeshRenderer);
      mr.mesh = mesh;
      const mat = makePlainMaterial(themeHex);
      if (mat) mr.material = mat;
      this._model = node;
      this.fitModel(node, mesh, TARGET_HEIGHT[this._stage]);
      this.applyBehavior();
    });
  }

  /** Mesh 子资源路径：.../<id>_<stage>/node_0（cc.Mesh） */
  private toMeshKey(path: string): string {
    const base = path
      .replace(/^resources\//, '')
      .replace(/\.(glb|fbx|obj|prefab)$/i, '');
    const segs = base.split('/');
    segs[segs.length - 1] = 'node_0';
    return segs.join('/');
  }

  /** 按 Mesh 包围盒归一化高度，并把脚底对齐到 y=0 */
  private fitModel(node: Node, mesh: Mesh, targetHeight: number): void {
    const st = mesh?.struct;
    if (!st || !st.minPosition || !st.maxPosition) {
      this._baseScale = new Vec3(1, 1, 1);
      this._baseY = 0;
      return;
    }
    const minY = st.minPosition.y;
    const sizeY = st.maxPosition.y - minY;
    if (sizeY < 0.001) {
      this._baseScale = new Vec3(1, 1, 1);
      this._baseY = 0;
      return;
    }
    const scale = targetHeight / sizeY;
    node.setScale(scale, scale, scale);
    const y = -minY * scale;
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

  /** 失落变灰（材质属性名不同版本有差异，失败不影响表现） */
  private tint(root: Node, color: Color): void {
    for (const r of root.getComponentsInChildren(MeshRenderer)) {
      try {
        const mat = r.material;
        if (mat) {
          mat.setProperty('albedo', color);
          mat.setProperty('mainColor', color);
        }
      } catch (e) {
        // ignore
      }
    }
  }
}
