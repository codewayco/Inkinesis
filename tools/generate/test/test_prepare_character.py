"""Behavioral tests of independent preparation on synthetic, known geometry."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('preparation', Path(__file__).parents[1]/'prepareCharacter.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PreparationTests(unittest.TestCase):
    def test_missing_feet_recovery_uses_source_and_leaves_existing_footwear_alone(self):
        ref=np.full((100,100,3),50,np.uint8);mask=np.zeros((100,100),np.uint8)
        mask[75:90,20:35]=255;mask[75:90,65:80]=255
        points={'ankleL':[27,76],'kneeL':[27,40],'ankleR':[72,76],'kneeR':[72,40]}
        layers={};result=m.recover_visible_feet(layers,ref,mask,points)
        self.assertTrue(result);self.assertEqual(layers['footwear'][80,27,3],255)
        self.assertEqual(layers['footwear'][80,50,3],0)
        before=layers['footwear'].copy()
        self.assertEqual(m.recover_visible_feet(layers,ref,mask,points),[])
        self.assertTrue(np.array_equal(before,layers['footwear']))

    def test_coat_opening_uses_visible_source_not_hidden_anatomy(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            analysis=Path(temp)/'analysis.json'
            analysis.write_text(json.dumps({'assessment':{'garments':[{'kind':'coat','confidence':.9}]}}))
            upper=np.zeros((64,64,4),np.uint8);upper[:]=[10,100,140,255]
            lower=np.zeros_like(upper);lower[:]=[45,45,45,255]
            ref=upper[:,:,:3].copy();ref[15:50,20:40]=lower[15:50,20:40,:3]
            layers={'topwear':upper.copy(),'legwear':lower.copy()}
            result=m.restore_visible_coat_opening(layers,ref,np.full((64,64),255,np.uint8),analysis)
            self.assertGreater(result[0]['removedOpaquePixels'],500)
            self.assertEqual(layers['topwear'][30,30,3],0)
            self.assertEqual(layers['topwear'][5,5,3],255)
            self.assertTrue(np.array_equal(layers['legwear'],lower))
            analysis.write_text(json.dumps({'assessment':{'garments':[{'kind':'skirt','confidence':.9}]}}))
            layers={'topwear':upper.copy(),'legwear':lower.copy()}
            self.assertEqual(m.restore_visible_coat_opening(layers,ref,np.full((64,64),255,np.uint8),analysis),[])
            self.assertTrue(np.array_equal(layers['topwear'],upper))

    def test_shared_pipeline_repairs_long_clothing_without_garment_route(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            analysis=Path(temp)/'analysis.json'
            analysis.write_text(json.dumps({'assessment':{'longGarment':True}}))
            upper=np.full((64,64,4),[10,100,140,255],np.uint8)
            lower=np.full_like(upper,[45,45,45,255])
            ref=upper[:,:,:3].copy();ref[15:50,20:40]=45
            layers={'topwear':upper.copy(),'legwear':lower.copy()}
            m.restore_visible_coat_opening(layers,ref,np.full((64,64),255,np.uint8),analysis)
            self.assertEqual(layers['topwear'][30,30,3],0)
            self.assertEqual(layers['topwear'][5,5,3],255)
            self.assertTrue(np.array_equal(layers['legwear'],lower))
            # No change when the source really contains the closed garment.
            layers={'topwear':upper.copy(),'legwear':lower.copy()}
            m.restore_visible_coat_opening(layers,upper[:,:,:3],np.full((64,64),255,np.uint8),analysis)
            self.assertTrue(np.array_equal(layers['topwear'],upper))

    def test_missing_face_recovery_is_bounded_and_preserves_other_layers(self):
        ref=np.full((120,100,3),[235,190,140],np.uint8)
        mask=np.zeros((120,100),np.uint8);mask[10:110,20:80]=255
        eye=np.zeros((120,100,4),np.uint8);eye[38:42,30:40]=[0,0,0,255]
        other=np.zeros_like(eye);other[38:42,60:70]=[0,0,0,255]
        mouth=np.zeros_like(eye);mouth[63:66,45:55]=[0,0,0,255]
        ref[38:42,30:40]=0;ref[38:42,60:70]=0;ref[63:66,45:55]=0
        face=np.zeros_like(eye);face[20:30,25:75]=[230,180,130,255]
        neck=np.zeros_like(eye);neck[70:100,35:65]=[120,90,60,255]
        layers={'face':face,'eyewhite-l':eye,'eyewhite-r':other,'mouth':mouth,'neck':neck}
        original={n:v.copy() for n,v in layers.items()}
        points={'eyeL':[35,40],'eyeR':[65,40],'mouth':[50,65],'chin':[50,78]}
        result=m.recover_face_support(layers,ref,mask,points)
        self.assertEqual(result['status'],'repaired')
        self.assertEqual(layers['face'][50,50,3],255)
        self.assertFalse(layers['face'][79:,:,3].any())
        self.assertFalse(layers['face'][:,:20,3].any())
        # Independent expression layers stay exact; the underlying eye is erased.
        for n in ['eyewhite-l','eyewhite-r','mouth']:
            self.assertTrue(np.array_equal(layers[n],original[n]))
        self.assertGreater(int(layers['face'][40,35,0]),200)
        self.assertTrue(np.array_equal(layers['neck'][:,:,3],original['neck'][:,:,3]))
        self.assertTrue(np.array_equal(layers['neck'][:79],original['neck'][:79]))
        # A healthy face is not modified on subsequent calls.
        before={n:v.copy() for n,v in layers.items()}
        self.assertEqual(m.recover_face_support(layers,ref,mask,points)['status'],'unchanged')
        self.assertTrue(all(np.array_equal(layers[n],v) for n,v in before.items()))

    def test_source_supported_jaw_is_not_copied_into_neck(self):
        ref=np.full((100,100,3),200,np.uint8);mask=np.full((100,100),255,np.uint8)
        points={'eyeL':[35,30],'eyeR':[65,30],'mouth':[50,55],'chin':[50,70]}
        back=np.zeros((100,100,4),np.uint8);back[60:79,45:55]=[110,30,150,255]
        ref[60:79,45:55]=[110,30,150]
        neck=np.full_like(back,[190,150,120,255])
        layers={'back hair':back.copy(),'neck':neck.copy()}
        result=m.recover_face_support(layers,ref,mask,points)
        self.assertEqual(result['sourceSupportedLowerBoundary'],78)
        self.assertEqual(layers['face'][78,50,3],255)
        self.assertTrue(np.array_equal(layers['neck'][:79],neck[:79]))
        self.assertTrue(np.array_equal(layers['back hair'],back))
        # Unsupported decomposition colors cannot extend the source jaw.
        layers={'back hair':back.copy()};layers['back hair'][:,:,:3]=0
        result=m.recover_face_support(layers,ref,mask,points)
        self.assertEqual(result['sourceSupportedLowerBoundary'],70)

    def test_face_recovery_requires_landmarks_and_can_recover_absent_layer(self):
        ref=np.full((100,100,3),200,np.uint8);mask=np.full((100,100),255,np.uint8)
        layers={}
        self.assertEqual(m.recover_face_support(layers,ref,mask,{})['status'],'not-repaired')
        self.assertEqual(layers,{})
        points={'eyeL':[35,30],'eyeR':[65,30],'mouth':[50,55],'chin':[50,70]}
        self.assertEqual(m.recover_face_support(layers,ref,mask,points)['status'],'repaired')
        self.assertEqual(layers['face'][45,50,3],255)

    def test_enclosed_white_clothing_survives(self):
        im=Image.new('RGB',(80,100),'white');d=ImageDraw.Draw(im)
        d.rectangle((20,10,60,90),fill='black');d.rectangle((23,13,57,87),fill='white')
        alpha,method=m.foreground(im)
        self.assertEqual(alpha[50,40],255)
        self.assertEqual(alpha[0,0],0)
        self.assertEqual(method,'border-connected-color')

    def test_source_alpha_not_thresholded(self):
        rgba=np.zeros((20,20,4),np.uint8);rgba[:,:,:3]=200;rgba[:,:,3]=128
        alpha,method=m.foreground(Image.fromarray(rgba))
        self.assertTrue(np.all(alpha==128));self.assertEqual(method,'source-alpha')

    def test_smooth_backdrop_does_not_erase_enclosed_white_shirt(self):
        rgb=np.zeros((100,80,3),np.uint8)
        rgb[:]=np.linspace(190,250,100).astype(np.uint8)[:,None,None]
        rgb[10:90,20:60]=20;rgb[15:85,25:55]=255
        alpha,method=m.foreground(Image.fromarray(rgb))
        self.assertEqual(method,'border-connected-smooth-field')
        self.assertEqual(alpha[50,40],255)
        self.assertLess(alpha[0,0],5);self.assertLess(alpha[-1,-1],5)

    def test_anatomical_partition_preserves_all_pixels(self):
        rgba=np.full((60,120,4),255,np.uint8)
        layers={'legwear':rgba.copy()}
        m.split_limbs(layers,{'kneeL':[95,30],'kneeR':[65,30]})
        self.assertEqual(layers['legwear-r'][30,75,3],255) # both knees right of canvas center
        self.assertEqual(layers['legwear-l'][30,90,3],255)
        total=layers['legwear-l'][:,:,3].astype(int)+layers['legwear-r'][:,:,3]
        self.assertTrue(np.all(total==255))

    def test_partial_missing_landmarks_preserve_unsplit_pixels(self):
        rgba=np.full((20,20,4),255,np.uint8)
        layers={'legwear':rgba.copy()}
        report=m.split_limbs(layers,{'kneeL':[15,10]},partial=True)
        self.assertTrue(np.array_equal(layers['legwear'],rgba))
        self.assertNotIn('legwear-l',layers)
        self.assertIn('retained unsplit',report[0]['operation'])

    def test_patch_does_not_modify_unrelated_pixels(self):
        ref=np.full((40,60,3),180,np.uint8);edited=ref.copy();edited[15:25,25:35]=20
        layer,_=m.patch(ref,edited,[20,10,40,30],'mouth_open')
        self.assertFalse(layer[:10,:,3].any());self.assertFalse(layer[:,40:,3].any())
        self.assertEqual(layer[20,30,3],255)

    def test_registration_recovers_known_translation_on_unchanged_pixels(self):
        rng=np.random.default_rng(12)
        texture=m.cv2.GaussianBlur(rng.integers(20,230,(100,100),dtype=np.uint8),(9,9),2)
        ref=np.repeat(texture[:,:,None],3,axis=2)
        shifted=m.cv2.warpAffine(ref,np.array([[1,0,2],[0,1,-1]],np.float32),(100,100),borderMode=m.cv2.BORDER_REFLECT)
        shifted[40:55,40:60]=20 # a genuine expression change must be excluded
        aligned,record=m.register_edit(ref,shifted,[[35,35,65,60]],[10,10,90,90])
        stable=np.ones((100,100),bool);stable[:15]=False;stable[85:]=False;stable[:,:15]=False;stable[:,85:]=False
        stable[30:65,30:70]=False
        before=np.abs(ref.astype(float)-shifted).mean(axis=2)[stable].mean()
        after=np.abs(ref.astype(float)-aligned).mean(axis=2)[stable].mean()
        self.assertLess(after,before*.4)
        self.assertAlmostEqual(record['translation'][0],2,delta=.3)
        self.assertAlmostEqual(record['translation'][1],-1,delta=.3)

    def test_skin_matching_uses_border_not_dark_expression(self):
        ref=np.full((40,60,3),180,np.uint8)
        edited=np.full_like(ref,190);edited[15:25,25:35]=30
        layer,record=m.patch(ref,edited,[20,10,40,30],'mouth_open')
        self.assertEqual(record['skinBias'],[-10,-10,-10])
        self.assertEqual(layer[20,30,0],20)

    def test_component_cleanup_keeps_separate_fingers(self):
        alpha=np.zeros((30,30),np.uint8);alpha[3:15,3:8]=255;alpha[3:15,12:17]=255;alpha[25,25]=255
        result=m.retain_components(alpha,12)
        self.assertEqual(int(np.count_nonzero(result)),120)

    def test_png_source_is_not_mutated(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);source=root/'source.png'
            im=Image.new('RGBA',(20,20),(10,20,30,128));im.save(source);before=m.sha(source)
            m.neutralize(source,root)
            self.assertEqual(m.sha(source),before)
            self.assertTrue((root/'input-mask.png').exists())


if __name__=='__main__':unittest.main()
