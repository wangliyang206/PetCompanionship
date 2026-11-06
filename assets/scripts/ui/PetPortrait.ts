/**
 * 卡片人像（T29）：把真实宠物模型渲染进一张 RenderTexture，供「恭喜获得」卡片中间显示。
 *
 * 为什么不用「把场景里的宠物挪到卡片位置」：
 *   卡片是全屏模态，3D 场景在 UI 下面，模型再怎么挪都会被卡片挡住；而卡片开个洞、
 *   让 3D 从洞里露出来，又要处理遮罩、层与投影，反而更难控。
 *
 * 也不复用场景里那只：破壳第 2 只起 activePetId 不会切（EggSystem.hatchEgg 只在无主宠时设置），
 *   场景里站着的可能还是旧宠物。人像必须按「这张卡片对应的 pet」自己加载。
 *
 * 做法：独立的正交相机只渲染 UI_3D 层，把模型渲染进 512² 的 RT（透明清屏），
 *   Sprite 叠在卡片上。模型停放在世界 y=-200 处（远离主相机视锥），不干扰主画面。
 *   材质与场景一致（makePlainMaterial → 内建 unlit 纯色），所以没有光源也能正确显色。
 */

import {
  Camera, Color, director, Layers, Material, Mesh, MeshRenderer, Node,
  RenderTexture, resources, Sprite, SpriteFrame, UITransform, Vec3,
} from 'cc';
import { PetState } from '../core/SaveData';
import { getSpecies } from '../pet/PetDefs';
import { PetViewModel } from '../pet/PetViewModel';
import { makePlainMaterial, makePetMaterial, loadPetAlbedo, petMeshKey, PET_TARGET_HEIGHT, uprightMetrics } from '../pet/PetView';
import { REVEAL_STAGE } from './EggArt';

/** RT 边长（像素）。卡片窗口约 264 设计像素，512 足够，显存约 1MB（低端机友好） */
const RT_SIZE = 512;

/** 人像模型的停放点：远离主相机视锥，避免主画面里多出一只宠物 */
const PARK = new Vec3(0, -200, 0);

export class PetPortrait {
  /** 挂到卡片下的 Sprite 节点（尺寸 = size × size 设计像素） */
  readonly node: Node;

  private _camNode: Node | null = null;
  private _cam: Camera | null = null;
  private _rt: RenderTexture | null = null;
  private _model: Node | null = null;
  private _disposed = false;
  private _state: 'loading' | 'ready' | 'failed' = 'loading';
  private _basePos = new Vec3();
  private _modelHeight = 0.85;
  private _elapsed = 0;

  constructor(parent: Node, size: number, pet: PetState) {
    // ---- UI：Sprite 承载 RT ----
    const n = new Node('PetPortrait');
    n.layer = Layers.Enum.UI_2D;
    n.setParent(parent);
    n.addComponent(UITransform).setContentSize(size, size);

    const rt = new RenderTexture();
    rt.reset({ width: RT_SIZE, height: RT_SIZE });
    this._rt = rt;

    const sf = new SpriteFrame();
    sf.texture = rt;
    sf.packable = false;

    const sp = n.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.trim = false;
    sp.spriteFrame = sf;
    this.node = n;

    // ---- 相机：正交、透明清屏、只拍 UI_3D ----
    const scene = director.getScene();
    if (!scene) {
      this._state = 'failed';
      return;
    }
    const camNode = new Node('PetPortraitCam');
    camNode.setParent(scene);
    const cam = camNode.addComponent(Camera);
    cam.projection = Camera.ProjectionType.ORTHO;
    cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    cam.clearColor = new Color(0, 0, 0, 0);
    cam.visibility = Layers.Enum.UI_3D;
    cam.near = 0.05;
    cam.far = 40;
    cam.targetTexture = rt;
    cam.priority = -1;
    this._camNode = camNode;
    this._cam = cam;

    this.loadModel(pet);
  }

  /** 供 dev 日志/自测用 */
  get state(): string {
    return this._state;
  }

  private loadModel(pet: PetState): void {
    const def = getSpecies(pet.speciesId);
    const path = PetViewModel.modelPath(pet);
    const themeHex = def?.themeColor ?? '#D9A066';
    const targetHeight = PET_TARGET_HEIGHT[pet.stage] ?? 0.85;
    if (!path) {
      this._state = 'failed';
      return;
    }

    resources.load(petMeshKey(path), Mesh, (err, mesh) => {
      if (this._disposed) return;
      if (err || !mesh) {
        console.warn('[PetPortrait] 模型加载失败，卡片人像留空:', petMeshKey(path), err);
        this._state = 'failed';
        return;
      }
      const scene = director.getScene();
      if (!scene || !this._camNode || !this._cam) {
        this._state = 'failed';
        return;
      }

      const node = new Node('PortraitPet');
      node.layer = Layers.Enum.UI_3D;
      node.setParent(scene);
      node.setPosition(PARK.x, PARK.y, PARK.z);
      // 模型是躺姿导出的：绕 X +90° 站起来，正面朝 +Z（相机就在 +Z，正好看到脸）
      node.setRotationFromEuler(90, 0, 0);

      const mr = node.addComponent(MeshRenderer);
      mr.mesh = mesh;
      const mat: Material | null = makePlainMaterial(themeHex);
      if (mat) {
        const count = (mr.materials?.length ?? 0) || 1;
        mr.materials = new Array(count).fill(mat);
      }
      this._model = node;

      // 贴图到位后换成「unlit + albedo」，卡片里就有眼睛和花纹了
      loadPetAlbedo(path, (tex) => {
        if (!tex || this._disposed || this._model !== node || !node.isValid) return;
        const texMat = makePetMaterial(themeHex, tex);
        if (!texMat) return;
        const count = (mr.materials?.length ?? 0) || 1;
        mr.materials = new Array(count).fill(texMat);
      });

      // 脚底对齐 PARK.y，并归一化到与场景一致的阶段高度（躺姿模型的高度取局部 Z 跨度，见 uprightMetrics）
      const { height, foot } = uprightMetrics(mesh);
      if (height > 0.001) {
        const s = targetHeight / height;
        node.setScale(s, s, s);
        node.setPosition(PARK.x, PARK.y + foot * s, PARK.z);
      }

      // 取景：正交高度 = 模型高 × orthoK（与卡片台座/投影共用同一个系数，见 EggArt.REVEAL_STAGE）
      this._modelHeight = targetHeight;
      this._basePos = node.position.clone();
      const center = new Vec3(PARK.x, PARK.y + targetHeight * 0.5, PARK.z);
      this._camNode.setWorldPosition(new Vec3(center.x, center.y, center.z + 4));
      this._camNode.lookAt(center);
      // 注意：Cocos 的 orthoHeight 是「视野半高」（默认 10 对应 20 的世界高度），
      // 所以这里除以 2，才能让「视野全高 = 模型高 × orthoK」与卡片台座的投影公式对得上。
      this._cam.orthoHeight = (targetHeight * REVEAL_STAGE.orthoK) / 2;
      this._cam.far = 40;
      this._state = 'ready';
    });
  }

  /**
   * 逐帧微动：轻微起伏 + 左右摇摆（±6°）。
   * 完全静止时会像一张贴纸，动一点就「活」了；幅度压得很小，不做整圈自转。
   * 基准姿态是绕 X +90°（躺姿模型站起来），摆动叠在 Y 轴上——(90, y, 0) 在 YXZ 序下
   * 正好是「先站起来、再绕竖直轴左右摆」。
   */
  tick(dt: number): void {
    const m = this._model;
    if (!m || !m.isValid || this._state !== 'ready') return;
    this._elapsed += dt;
    const t = this._elapsed;
    const h = this._modelHeight;
    m.setPosition(this._basePos.x, this._basePos.y + Math.sin(t * 1.8) * h * 0.018, this._basePos.z);
    m.setRotationFromEuler(90, Math.sin(t * 1.1) * 6, 0);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._cam) this._cam.targetTexture = null;
    if (this._model && this._model.isValid) {
      this._model.destroy();
      this._model = null;
    }
    if (this._camNode && this._camNode.isValid) {
      this._camNode.destroy();
      this._camNode = null;
    }
    if (this._rt) {
      this._rt.destroy();
      this._rt = null;
    }
    this._cam = null;
    if (this.node && this.node.isValid) this.node.destroy();
  }
}
