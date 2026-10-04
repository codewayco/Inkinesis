"""Behavioral tests of independent preparation on synthetic, known geometry."""
import importlib.util
from pathlib import Path
import json
import tempfile
import unittest
import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location('preparation', Path(__file__).parents[1]/'prepareCharacter.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PreparationTests(unittest.TestCase):

    def test_rest_shows_the_source_only_through_the_topmost_opaque_layer_away_from_the_edge(self):
        ref=np.zeros((60,60,3),np.uint8);ref[:]=[200,150,120];ref[30:40,20:40]=[30,20,20]   # a dark beard the layers lost
        mask=np.zeros((60,60),np.uint8);mask[5:55,5:55]=255
        face=np.zeros((60,60,4),np.uint8);face[5:55,5:55]=[200,150,120,255]                 # clean-shaven redraw
        neck=np.zeros_like(face);neck[30:55,5:55]=[180,130,100,255]                         # lower layer, also wrong
        veil=np.zeros_like(face);veil[30:40,20:30]=[90,90,90,120]                           # soft layer above part of it
        layers={'neck':neck,'face':face,'front hair':veil}
        record=m.restore_rest_color(layers,ref,mask,['neck','face','front hair'])
        self.assertEqual(layers['face'][35,35,:3].tolist(),[30,20,20])        # topmost opaque layer takes the source
        # Under a soft layer the face is solved so that the blend shows the source.
        a=120/255;blend=layers['front hair'][35,25,:3]*a+layers['face'][35,25,:3]*(1-a)
        before=np.array([90,90,90])*a+np.array([200,150,120])*(1-a)
        self.assertLess(np.abs(blend-ref[35,25]).max(),np.abs(before-ref[35,25]).max())
        self.assertEqual(layers['neck'][35,35,:3].tolist(),[180,130,100])     # lower layers never change
        self.assertEqual(layers['face'][5,30,3],255)
        self.assertEqual(record['changedPixels']['face'],10*10)
        ref[5:8,5:55]=[0,0,0]                                                  # silhouette band: left alone
        before=layers['face'][5:8].copy();m.restore_rest_color(layers,ref,mask,['neck','face','front hair'])
        self.assertTrue(np.array_equal(layers['face'][5:8],before))

    def _contract_figure(self, arm_gap=True, leg_gap=True, margin=True, transparent=True):
        h,w=300,200;img=np.zeros((h,w,4),np.uint8)
        if not transparent: img[:,:]=[255,255,255,255]
        col=[120,90,200,255]
        top=10 if margin else 0
        img[top:60,80:120]=col                       # head
        img[60:170,70:130]=col                       # torso
        ax=(52,64) if arm_gap else (58,70)           # left arm (image left), gap to the torso at x=64..70
        img[60:170,ax[0]:ax[1]]=col;img[60:170,200-ax[1]:200-ax[0]]=col
        img[170:290,72:96]=col;img[170:290,(96 if not leg_gap else 104):128]=col
        pts={'shoulderR':(70,65),'shoulderL':(130,65),'elbowR':(58,110),'wristR':(58,160),'elbowL':(142,110),'wristL':(142,160),
             'hipR':(84,170),'hipL':(116,170),'kneeR':(84,230),'kneeL':(116,230),'ankleR':(84,285),'ankleL':(116,285)}
        if not arm_gap: pts.update({'elbowR':(64,110),'wristR':(64,160),'elbowL':(136,110),'wristL':(136,160)})
        return Image.fromarray(img),{'points':{k:{'x':x,'y':y} for k,(x,y) in pts.items()}}

    def test_source_check_passes_a_contract_figure_and_reports_each_failed_item(self):
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp)
            def run(**kw):
                im,analysis=self._contract_figure(**kw);im.save(d/'s.png');(d/'a.json').write_text(json.dumps(analysis))
                m.source_check(d/'s.png',d/'a.json',d)
                return {c['item']+c['name']:c['status'] for c in json.loads((d/'source-check.json').read_text())['checks']}
            ok=run()
            self.assertTrue(all(v=='pass' for v in ok.values()),ok)
            arms=run(arm_gap=False)
            self.assertEqual([k for k,v in arms.items() if v=='fail'],['P2left arm clear of the torso','P2right arm clear of the torso'])
            legs=run(leg_gap=False)
            self.assertEqual([k for k,v in legs.items() if v=='fail'],['P3legs apart'])
            edge=run(margin=False)
            self.assertEqual([k for k,v in edge.items() if v=='fail'],['C2figure margin'])
            white=run(transparent=False)
            self.assertEqual(white['C1transparent background'],'fail')
    def test_hair_occlusion_cleanup_removes_new_specks_but_keeps_original_separate_strands(self):
        before=np.zeros((100,100),np.uint8)
        before[5:65,10:80]=255;before[65:85,40:44]=255
        before[72:90,84:86]=255  # A separate authored wisp, present before clipping.
        after=before.copy();after[65:80,40:44]=0
        supported=np.ones(before.shape,bool)
        repaired=m.remove_new_hair_specks(before,after,supported)
        self.assertEqual(repaired[82,42],0)
        self.assertEqual(repaired[80,85],255)
        self.assertTrue(np.array_equal(repaired[:65],after[:65]))
        self.assertTrue(np.array_equal(m.remove_new_hair_specks(before,before,supported),before))
        # A real lock can disappear behind an occluder and emerge as a small
        # island. Topology alone cannot authorize erasing its visible tip.
        supported[80:85,40:44]=False
        self.assertTrue(np.array_equal(m.remove_new_hair_specks(before,after,supported),after))

    def test_headwear_behind_face_is_clipped_but_visible_brim_stays(self):
        skin,hood,brim=[150,95,70],[190,165,150],[60,40,90]
        face=np.zeros((80,80,4),np.uint8);face[20:70,20:60]=skin+[255]
        hat=np.zeros_like(face);hat[10:75,10:70]=hood+[255];hat[10:30,10:70]=brim+[255]
        ref=np.full((80,80,3),255,np.uint8);ref[10:75,10:70]=hood;ref[20:70,20:60]=skin;ref[10:30,10:70]=brim
        layers={'face':face.copy(),'headwear':hat.copy()}
        result=m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),sorted(layers,key=m.depth))
        self.assertEqual([r['layer'] for r in result],['headwear'])
        self.assertGreater(result[0]['removedOpaquePixels'],800)
        self.assertEqual(layers['headwear'][50,40,3],0)
        self.assertEqual(layers['headwear'][15,40,3],255)
        self.assertEqual(layers['headwear'][50,14,3],255)
        self.assertTrue(np.array_equal(layers['face'],face))
        # A source that really shows the headwear over the face keeps it.
        layers={'face':face.copy(),'headwear':hat.copy()}
        ref=hat[:,:,:3].copy();ref[hat[:,:,3]==0]=255
        self.assertEqual(m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),sorted(layers,key=m.depth)),[])
        self.assertTrue(np.array_equal(layers['headwear'],hat))

    def test_invented_layer_over_garment_is_clipped_everywhere_it_contradicts_source(self):
        skirt,tail=[70,80,40],[200,185,160]
        bottom=np.zeros((80,80,4),np.uint8);bottom[10:75,15:65]=skirt+[255]
        extra=np.zeros_like(bottom);extra[20:70,30:50]=tail+[255]
        ref=np.full((80,80,3),255,np.uint8);ref[10:75,15:65]=skirt
        layers={'bottomwear':bottom.copy(),'tail':extra.copy()}
        result=m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),sorted(layers,key=m.depth))
        self.assertEqual([r['layer'] for r in result],['tail'])
        self.assertEqual(layers['tail'][45,40,3],0)
        self.assertTrue(np.array_equal(layers['bottomwear'],bottom))

    def test_two_wrong_layers_over_the_source_garment_are_both_clipped(self):
        skirt,grey=[70,80,40],[180,180,175]
        bottom=np.zeros((80,80,4),np.uint8);bottom[10:70,10:70]=skirt+[255]
        tail=np.zeros_like(bottom);tail[20:60,20:60]=grey+[255]
        prop=np.zeros_like(bottom);prop[25:55,25:55]=[200,200,200,255]
        ref=np.full((80,80,3),255,np.uint8);ref[10:70,10:70]=skirt
        layers={'bottomwear':bottom.copy(),'tail':tail.copy(),'objects':prop.copy()}
        result=m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),['bottomwear','tail','objects'])
        self.assertEqual(sorted(r['layer'] for r in result),['objects','tail'])
        self.assertEqual(layers['tail'][40,40,3],0);self.assertEqual(layers['objects'][40,40,3],0)
        self.assertTrue(np.array_equal(layers['bottomwear'],bottom))

    def test_uncovered_garment_joins_continuous_neighbour_only(self):
        cloth,shoe,stool=[120,30,40],[200,30,30],[40,160,160]
        ref=np.full((120,120,3),255,np.uint8);mask=np.zeros((120,120),np.uint8)
        ref[20:100,30:60]=cloth;mask[20:100,30:60]=255
        ref[100:110,30:60]=shoe;mask[100:110,30:60]=255
        ref[60:100,70:100]=stool;mask[60:100,70:100]=255
        drape=np.zeros((120,120,4),np.uint8);drape[20:100,30:38]=cloth+[255]
        feet=np.zeros_like(drape);feet[100:110,30:60]=shoe+[255]
        layers={'bottomwear':drape.copy(),'footwear':feet.copy()}
        result=m.recover_uncovered_source(layers,ref,mask,{})
        self.assertEqual([r['layer'] for r in result],['bottomwear','prop'])
        self.assertEqual(layers['bottomwear'][60,50,3],255)
        self.assertTrue(np.array_equal(layers['bottomwear'][60,50,:3],cloth))
        self.assertEqual(layers['bottomwear'][80,85,3],0)
        # The stool has no continuous neighbour: it stays visible as a static part.
        self.assertEqual(layers['prop'][80,85,3],255)
        self.assertTrue(np.array_equal(layers['prop'][80,85,:3],stool))
        self.assertEqual(result[1]['rule'],'omitted part kept as a static part behind its neighbours')
        self.assertTrue(np.array_equal(layers['footwear'],feet))

    def test_large_uncovered_leg_is_not_carried_by_a_resting_hand(self):
        cloth=[230,230,225]
        ref=np.full((120,120,3),40,np.uint8);mask=np.zeros((120,120),np.uint8)
        ref[20:100,30:60]=cloth;mask[20:100,30:60]=255
        hand=np.zeros((120,120,4),np.uint8);hand[10:30,30:45]=cloth+[255]
        ref[10:30,30:45]=cloth;mask[10:30,30:45]=255
        layers={'handwear-r':hand.copy()}
        result=m.recover_uncovered_source(layers,ref,mask,{'ankleR':[45,102]})
        self.assertEqual(result[0]['layer'],'legwear')
        self.assertTrue(np.array_equal(layers['handwear-r'],hand))
        self.assertEqual(layers['legwear'][60,45,3],255)
        # Without an ankle the leg is still kept, as a static part, never by the hand.
        layers={'handwear-r':hand.copy()}
        result=m.recover_uncovered_source(layers,ref,mask,{})
        self.assertEqual([r['layer'] for r in result],['prop'])
        self.assertTrue(np.array_equal(layers['handwear-r'],hand))

    def test_omitted_part_crossed_by_a_faint_layer_edge_has_one_owner(self):
        cap=[180,40,90];ref=np.full((120,120,3),250,np.uint8);ref[5:95,20:100]=cap
        mask=np.zeros((120,120),np.uint8);mask[5:95,20:100]=255
        back=np.zeros((120,120,4),np.uint8);back[5:15,20:100]=cap+[255]           # back hair above the omitted cap top
        hat=np.zeros_like(back);hat[80:95,20:100]=cap+[255];hat[45,20:100]=cap+[60]   # the hat below, its faint crop line across
        layers={'back hair':back,'headwear':hat}
        records=m.recover_uncovered_source(layers,ref,mask,{})
        owners={n for n,l in layers.items() if l[30,60,3]>128}|{n for n,l in layers.items() if l[65,60,3]>128}
        self.assertEqual(len(owners),1);self.assertEqual(len([r for r in records if r['addedPixels']>500]),1)

    def test_omitted_ear_above_the_chin_never_goes_to_the_neck(self):
        skin=[200,150,120];ref=np.full((120,120,3),250,np.uint8);mask=np.zeros((120,120),np.uint8)
        face=np.zeros((120,120,4),np.uint8);face[20:62,52:80]=skin+[255]
        neck=np.zeros_like(face);neck[28:100,40:80]=skin+[255]                 # the neck reaches up behind the jaw
        ref[20:100,40:80]=skin;mask[20:100,40:80]=255
        ref[25:52,18:40]=skin;mask[25:52,18:40]=255                          # the ear nobody owns, beside the neck
        layers={'face':face,'neck':neck}
        m.recover_uncovered_source(layers,ref,mask,{'chin':[65,62]})
        self.assertEqual(layers['neck'][38,30,3],0);self.assertEqual(layers['face'][38,30,3],255)

    def test_feather_sweeping_out_of_a_wide_hairdo_stays_with_the_head(self):
        hair=[60,40,30];ref=np.full((200,200,3),250,np.uint8);mask=np.zeros((200,200),np.uint8)
        face=np.zeros((200,200,4),np.uint8);face[50:80,85:115]=[200,150,120,255]
        back=np.zeros_like(face);back[30:80,40:160]=hair+[255]               # a wide hairdo, far wider than the face
        ref[30:80,40:160]=hair;ref[50:80,85:115]=[200,150,120];mask[30:80,40:160]=255
        ref[20:40,150:172]=[200,120,40];mask[20:40,150:172]=255                # a feather nobody owns, out to the side
        layers={'face':face,'back hair':back}
        records=m.recover_uncovered_source(layers,ref,mask,{'chin':[100,80]})
        self.assertNotIn("prop",layers);self.assertEqual(layers["back hair"][30,168,3],255)

    # --- Order, occlusion and ownership ------------------------------------------
    def test_raising_a_layer_never_jumps_over_a_layer_the_source_shows_in_front(self):
        trousers,hand,prop=[230,225,210],[150,100,80],[40,160,160]
        legs=np.zeros((100,100,4),np.uint8);legs[20:90,10:90]=trousers+[255]
        arm=np.zeros_like(legs);arm[40:60,30:50]=hand+[255]
        obj=np.zeros_like(legs);obj[60:95,60:95]=prop+[255]
        ref=np.full((100,100,3),255,np.uint8);ref[20:90,10:90]=trousers;ref[40:60,30:50]=hand;ref[60:95,60:95]=prop;ref[60:90,60:90]=trousers
        layers={'legwear-l':legs,'arm-l':arm,'objects':obj}
        order,records=m.source_draw_order(layers,ref,np.full((100,100),255,np.uint8))
        self.assertGreater(order.index('legwear-l'),order.index('objects'))
        self.assertGreater(order.index('arm-l'),order.index('legwear-l'))

    def test_occlusion_repair_does_not_cut_a_layer_where_another_part_shows(self):
        trousers,hand=[230,225,210],[150,100,80]
        legs=np.zeros((80,80,4),np.uint8);legs[10:70,10:70]=trousers+[255]
        arm=np.zeros_like(legs);arm[30:45,20:50]=hand+[255]
        ref=np.full((80,80,3),255,np.uint8);ref[10:70,10:70]=trousers;ref[30:45,20:50]=hand
        layers={'arm-l':arm.copy(),'legwear-l':legs.copy()}
        self.assertEqual(m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),['arm-l','legwear-l']),[])
        self.assertTrue(np.array_equal(layers['legwear-l'],legs))

    def test_omitted_head_part_joins_the_head_and_small_parts_join_their_limb(self):
        hair,ear=[30,20,20],[220,120,60]
        ref=np.full((120,120,3),255,np.uint8);mask=np.zeros((120,120),np.uint8)
        ref[20:60,30:80]=hair;mask[20:60,30:80]=255;ref[25:45,80:95]=ear;mask[25:45,80:95]=255
        front=np.zeros((120,120,4),np.uint8);front[20:60,30:80]=hair+[255]
        layers={'front hair':front}
        result=m.recover_uncovered_source(layers,ref,mask,{})
        self.assertEqual(result[0]['layer'],'front hair');self.assertEqual(result[0]['rule'],'omitted part attached to the head')
        self.assertEqual(layers['front hair'][35,88,3],255)

    def test_tiny_uncovered_sliver_is_not_copied_from_the_source(self):
        skin,cloth=[200,150,120],[240,240,235]
        ref=np.full((60,60,3),255,np.uint8);mask=np.zeros((60,60),np.uint8);mask[10:50,10:50]=255
        ref[10:30,10:50]=skin;ref[31:50,10:50]=cloth;ref[30:31,10:50]=[150,110,90]
        face=np.zeros((60,60,4),np.uint8);face[10:30,10:50]=skin+[255]
        top=np.zeros_like(face);top[31:50,10:50]=cloth+[255]
        layers={'face':face,'topwear':top}
        result=m.recover_uncovered_source(layers,ref,mask,{})
        # A sliver this small is usually the source's anti-aliased edge blended
        # with the backdrop; copying it would add a light fringe.
        self.assertEqual(result,[])
        self.assertTrue(all(layers[n][30,30,3]==0 for n in layers))

    def test_face_is_never_reordered_against_garments_or_hair(self):
        skin,cloth=[200,150,120],[240,240,235]
        face=np.zeros((80,80,4),np.uint8);face[10:60,20:60]=skin+[255]
        top=np.zeros_like(face);top[45:80,10:70]=cloth+[255]
        ref=np.full((80,80,3),255,np.uint8);ref[10:60,20:60]=skin;ref[45:80,10:70]=cloth   # collar over the hidden chin
        order,records=m.source_draw_order({'face':face,'topwear':top},ref,np.full((80,80),255,np.uint8))
        self.assertEqual(order,['topwear','face']);self.assertEqual(records,[])

    def test_omitted_curl_joins_the_hair_it_continues_not_a_static_part(self):
        hair,skin,cloth=[200,60,60],[210,160,130],[30,40,90]
        ref=np.full((120,120,3),255,np.uint8);mask=np.zeros((120,120),np.uint8)
        ref[10:50,30:80]=hair;mask[10:50,30:80]=255
        ref[50:110,20:100]=cloth;mask[50:110,20:100]=255
        ref[47:90,80:86]=hair;mask[47:90,80:86]=255        # curl hanging over the collar, mostly beside cloth
        front=np.zeros((120,120,4),np.uint8);front[10:50,30:80]=hair+[255]
        top=np.zeros_like(front);top[50:110,20:100]=cloth+[255];top[47:90,80:86,3]=0
        layers={'front hair':front,'topwear':top}
        result=m.recover_uncovered_source(layers,ref,mask,{})
        self.assertEqual([r['layer'] for r in result if r['rule'].startswith('omitted')],['front hair'])

    def test_occlusion_repair_keeps_a_layers_own_surface_inside_it(self):
        cap=np.array([200,40,60]);ref=np.zeros((80,80,3),np.uint8);ref[:]=cap
        back=np.zeros((80,80,4),np.uint8);back[10:70,10:70]=list(cap)+[255]
        hat=np.zeros_like(back);hat[10:70,10:70]=list(cap)+[255];hat[30:45,30:45,:3]=[120,120,200]   # painted differently there
        layers={'back hair':back,'headwear':hat}
        m.reveal_source_occlusion(layers,ref,np.full((80,80),255,np.uint8),['back hair','headwear'])
        self.assertEqual(layers['headwear'][37,37,3],255)

    def test_an_omitted_arm_never_joins_a_head_layer(self):
        skin,sleeve=[210,160,130],[235,235,240]
        h=w=200;ref=np.full((h,w,3),255,np.uint8);mask=np.zeros((h,w),np.uint8)
        face=np.zeros((h,w,4),np.uint8);face[20:50,90:120]=skin+[255];ref[20:50,90:120]=skin;mask[20:50,90:120]=255
        hat=np.zeros_like(face);hat[5:20,85:125]=sleeve+[255];ref[5:20,85:125]=sleeve;mask[5:20,85:125]=255
        ref[5:190,20:85]=sleeve;mask[5:190,20:85]=255     # a raised sleeve and arm no layer holds, touching the hat
        layers={'face':face,'headwear':hat}
        m.recover_uncovered_source(layers,ref,mask,{'chin':[105,50]})
        self.assertEqual(layers['headwear'][150,50,3],0)

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









    # --- Landmark verification -------------------------------------------------
    def _face_layers(self, size=200):
        def disc(cx,cy,r,color):
            a=np.zeros((size,size,4),np.uint8);yy,xx=np.mgrid[:size,:size]
            a[(xx-cx)**2+(yy-cy)**2<=r*r]=color+[255];return a
        layers={'face':disc(100,60,40,[200,160,140]),'irides-l':disc(115,50,4,[40,40,90]),'irides-r':disc(85,50,4,[40,40,90]),
                'eyewhite-l':disc(115,50,7,[250,250,250]),'eyewhite-r':disc(85,50,7,[250,250,250]),'mouth':disc(100,80,5,[180,60,60])}
        return layers

    def test_width_normalized_face_landmarks_are_corrected_on_the_eye_layers(self):
        layers=self._face_layers();mask=np.zeros((200,200),np.uint8);mask[15:195,40:160]=255
        # Canvas equals a 200x200 source; y given as if divided by width*1.5.
        wrong={'eyeL':{'x':.575,'y':.375,'confidence':.9},'eyeR':{'x':.425,'y':.375,'confidence':.9},'mouth':{'x':.5,'y':.6,'confidence':.9},
               'chin':{'x':.5,'y':.75,'confidence':.8}}
        points,records=m.verify_landmarks(layers,mask,wrong,(200,200),(200,200))
        self.assertAlmostEqual(points['eyeL']['y']*200,50,delta=2);self.assertAlmostEqual(points['mouth']['y']*200,80,delta=2)
        self.assertEqual(points['eyeL']['confidence'],.9)
        self.assertLess(points['chin']['y']*200,105)
        self.assertTrue(all(r['status']=='corrected' for r in records))
        right={'eyeL':{'x':.575,'y':.25,'confidence':.9},'eyeR':{'x':.425,'y':.25,'confidence':.9},'mouth':{'x':.5,'y':.4,'confidence':.9},
               'chin':{'x':.5,'y':.49,'confidence':.8}}
        points,records=m.verify_landmarks(layers,mask,right,(200,200),(200,200))
        self.assertEqual(records,[]);self.assertEqual(points,right)

    def test_joint_off_its_limb_is_reread_or_rejected_but_ankles_are_never_moved_up(self):
        # A 400x600 source on a 600x600 canvas: x_canvas = 400*x+100, y_canvas = 600*y.
        layers=self._face_layers(600);mask=np.zeros((600,600),np.uint8);mask[10:600,170:500]=255;mask[10:120,60:170]=255
        arm=np.zeros((600,600,4),np.uint8);arm[100:220,400:430]=[150,100,80,255];layers['handwear-l']=arm
        legs=np.zeros_like(arm);legs[250:590,200:300]=[60,60,90,255];layers['legwear']=legs
        n=lambda x,y:{'x':(x-100)/400,'y':y/600,'confidence':.8}
        points={'eyeL':n(115,50),'eyeR':n(85,50),'elbowL':n(415,150),
                # wrist at canvas y 210, answered as if y were divided by the width
                'wristL':{'x':.7875,'y':210/400,'confidence':.8},
                'ankleL':{'x':0.,'y':.97,'confidence':.8},'hipL':n(250,420),'kneeL':n(250,425)}
        out,records=m.verify_landmarks(layers,mask,points,(400,600),(600,600))
        self.assertAlmostEqual(out['wristL']['y']*600,210,delta=1)
        self.assertEqual(out['elbowL'],points['elbowL'])
        self.assertIsNone(out['ankleL'])
        # A seated knee level with its hip is not an inversion.
        self.assertEqual(out['kneeL'],points['kneeL']);self.assertEqual(out['hipL'],points['hipL'])




    # --- Mouth and eye patches --------------------------------------------------
    def test_closed_mouth_is_the_lip_shape_not_a_box_and_never_background(self):
        skin=[200,150,120];ref=np.full((80,80,3),250,np.uint8);ref[10:70,10:60]=skin
        ref[40:44,25:45]=[150,60,60];ref[48,20:50]=[90,60,50]   # lips and a jaw line below them
        face=np.zeros((80,80,4),np.uint8);face[10:70,10:60]=skin+[255]
        mouth=np.zeros_like(face);mouth[40:44,25:45]=[150,60,60,255]
        layers={'face':face,'mouth':mouth};mask=np.zeros((80,80),np.uint8);mask[10:70,10:60]=255
        region=m.mouth_close_region(layers,ref,mask,m.skin_model(ref,layers,mask,np.ones((80,80),bool)),False)
        self.assertTrue(region[42,35]);self.assertFalse(region[48,35]);self.assertFalse(region[30,35])
        layer,record=m.shaped_patch(ref,ref,region|(np.arange(80)[None,:]>58),m.face_support(layers,mask),'mouth_close',color_match=False)
        self.assertEqual(layer[42,70,3],0)   # outside the silhouette nothing is copied
        self.assertEqual(layer[42,35,3],255);self.assertEqual(layer[30,35,3],0)

    def test_moustache_the_face_already_carries_stays_on_the_face(self):
        skin=[200,150,120];hair=[240,240,240]
        ref=np.full((80,80,3),250,np.uint8);ref[10:70,10:60]=skin;ref[36:40,20:50]=hair;ref[41:44,27:43]=[150,60,60]
        face=np.zeros((80,80,4),np.uint8);face[10:70,10:60]=skin+[255];face[36:40,20:50]=hair+[255]
        mouth=np.zeros_like(face);mouth[36:40,20:50]=hair+[255];mouth[41:44,27:43]=[150,60,60,255]
        layers={'face':face,'mouth':mouth};mask=np.zeros((80,80),np.uint8);mask[10:70,10:60]=255
        region=m.mouth_close_region(layers,ref,mask,None,True)
        self.assertFalse(region[38,24]);self.assertTrue(region[42,35])

    def test_lips_and_lip_line_stay_in_the_closed_mouth_beside_stubble(self):
        # Stubble around the mouth has the color of the lip line, and the face
        # beneath draws the lips too; neither makes the lips facial hair.
        h=w=100;skin=np.array([200,150,120],np.uint8);stubble=[90,70,60]
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin
        ref[28:34,22:78]=stubble;ref[52:62,22:78]=stubble
        ref[39:46,30:70]=[190,105,100];ref[42,34:66]=stubble                       # lips with a dark lip line
        mouth=np.zeros((h,w,4),np.uint8);mouth[39:46,30:70,:3]=ref[39:46,30:70];mouth[39:46,30:70,3]=255
        face=np.dstack([ref,np.zeros((h,w),np.uint8)]).copy();face[10:90,10:90,3]=255
        layers={'face':face,'mouth':mouth};mask=np.full((h,w),255,np.uint8)
        region=m.mouth_close_region(layers,ref,mask,{'median':skin.astype(np.float32),'tolerance':30.},True)
        self.assertTrue(region[42,50]);self.assertTrue(region[40,50]);self.assertFalse(region[56,50])

    def test_open_mouth_has_no_holes_where_a_tuft_lay_under_the_opening(self):
        skin=[200,150,120];ref=np.full((90,90,3),250,np.uint8);ref[10:80,10:70]=skin;ref[49:51,33:38]=[50,35,30]   # a tuft under the lips
        edited=ref.copy();edited[36:48,24:46]=[40,10,10];edited[48:58,22:48]=[200,90,90]                          # the opening and its lower lip
        support=np.zeros((90,90),bool);support[10:80,10:70]=True
        cavity=np.zeros((90,90),bool);cavity[36:48,24:46]=True
        skinm={'median':np.array(skin,np.float32),'tolerance':20.}
        region,hair=m.mouth_open_region(ref,edited,cavity,[15,25,60,70],support,skinm,True,None)
        self.assertTrue(region[50,35]);self.assertFalse(hair[50,35])






    def test_open_mouth_keeps_the_source_lipstick(self):
        skin=np.array([190,130,100],np.uint8);ref=np.zeros((80,80,3),np.uint8);ref[:]=skin;ref[38:44,25:55]=[120,30,40]   # red lips
        edited=ref.copy();edited[:]=skin;edited[36:48,25:55]=[165,100,95];edited[39:45,29:51]=[40,10,10];edited[40,30:50]=[245,245,240]
        cavity=np.zeros((80,80),bool);cavity[39:45,29:51]=True
        region=np.zeros((80,80),bool);region[34:50,22:58]=True
        closed=np.zeros((80,80),bool);closed[38:44,25:55]=True
        out,record=m.keep_lip_color(ref,edited,cavity,region,closed,{'median':skin.astype(np.float32),'tolerance':20.})
        chroma=lambda v:np.asarray(v,np.float32)/max(1.,float(np.sum(v)))
        self.assertIsNotNone(record);self.assertLess(np.abs(chroma(out[46,40])-chroma([120,30,40])).max(),.03)
        self.assertTrue(np.array_equal(out[42,40],edited[42,40]));self.assertTrue(np.array_equal(out[20,40],edited[20,40]))
        # Natural lips: nothing changes.
        ref2=ref.copy();ref2[38:44,25:55]=[200,135,110]
        self.assertIsNone(m.keep_lip_color(ref2,edited,cavity,region,closed,{'median':skin.astype(np.float32),'tolerance':20.})[1])







    def test_open_mouth_patch_follows_the_changed_region_and_spares_facial_hair(self):
        skin=[200,150,120];ref=np.full((80,80,3),250,np.uint8);ref[10:70,10:60]=skin;ref[34:37,22:48]=[240,240,240]
        edited=ref.copy();edited[38:48,26:44]=[40,10,10];edited[34:37,22:48]=skin   # the edit also erased the moustache
        support=np.zeros((80,80),bool);support[10:70,10:60]=True
        cavity=np.zeros((80,80),bool);cavity[38:48,26:44]=True
        skinm={'median':np.array(skin,np.float32),'tolerance':20.}
        region,hair=m.mouth_open_region(ref,edited,cavity,[15,25,55,60],support,skinm,True,None)
        self.assertTrue(region[43,35]);self.assertFalse(region[35,30]);self.assertTrue(hair[35,30])
        self.assertFalse(region[20,35])

    def test_closed_eye_patch_never_covers_the_brow(self):
        skin=[200,150,120];ref=np.full((60,60,3),250,np.uint8);ref[:]=skin
        white=np.zeros((60,60,4),np.uint8);white[30:36,20:40]=[250,250,250,255]
        brow=np.zeros_like(white);brow[22:25,20:40]=[60,40,30,255]
        ref[30:36,20:40]=250;ref[22:25,20:40]=[60,40,30]
        edited=ref.copy();edited[30:36,20:40]=skin;edited[33,20:40]=[30,20,20];edited[22:25,20:40]=[200,200,40]  # a recoloured brow
        layers={'eyewhite-l':white,'eyebrow-l':brow}
        region=m.eye_close_region(layers,ref,edited,'l',np.ones((60,60),bool))
        self.assertTrue(region[33,30]);self.assertFalse(region[23,30])
        self.assertLess(m.ORDER['eye_close'],m.ORDER['eyebrow'])




















    def test_open_mouth_patch_stays_around_the_mouth_and_out_of_the_moustache(self):
        h=w=120;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin;ref[50:56,40:80]=[60,60,70]      # moustache over the lips
        ref[52:54,52:56]=skin                                                    # skin between strands
        ref[58:62,48:72]=[170,80,80]                                             # closed lips
        edited=ref.copy();edited[10:30,30:90]=[90,60,40]                         # the edit repainted the eyes too
        edited[57:70,48:72]=[40,10,10];edited[52:54,52:56]=[220,170,140]
        cavity=np.zeros((h,w),bool);cavity[60:70,50:70]=True
        support=np.ones((h,w),bool);closed=np.zeros((h,w),bool);closed[58:62,48:72]=True
        eyes=np.zeros((h,w),bool);eyes[10:30,30:90]=True
        model={'median':skin.astype(np.float32),'tolerance':30.}
        region,hair=m.mouth_open_region(ref,edited,cavity,[0,0,w,h],support,model,True,closed,eyes)
        self.assertFalse(region[20,60]);self.assertFalse(region[53,54]);self.assertFalse(region[51,45])
        self.assertTrue(region[64,60])

    def test_moustache_drawn_into_the_mouth_layer_stays_on_the_face(self):
        h=w=100;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin;ref[40:50,25:75]=[230,230,235];ref[50:54,40:60]=[170,80,80]
        mouth=np.zeros((h,w,4),np.uint8);mouth[46:54,38:62,:3]=ref[46:54,38:62];mouth[46:54,38:62,3]=255
        face=np.zeros((h,w,4),np.uint8);face[10:90,10:90]=list(skin)+[255]
        layers={'face':face,'mouth':mouth};mask=np.full((h,w),255,np.uint8)
        model={'median':skin.astype(np.float32),'tolerance':30.}
        region=m.mouth_close_region(layers,ref,mask,model,True)
        self.assertTrue(region[52,50]);self.assertFalse(region[47,45])

    def test_moustache_over_the_opening_stays_in_front_but_a_thin_crease_does_not(self):
        h=w=120;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin
        ref[40:52,35:85]=[60,40,30]                                              # moustache reaching over the opening's top
        ref[40:56,92:94]=[60,40,30]                                              # a thin smile crease reaching as high
        cavity=np.zeros((h,w),bool);cavity[50:64,45:75]=True
        support=np.ones((h,w),bool);model={'median':skin.astype(np.float32),'tolerance':30.}
        front=m.front_facial_hair(ref,cavity,[0,0,w,h],support,model,80)
        self.assertTrue(front[45,60]);self.assertTrue(front[51,60])
        self.assertFalse(front[47,92]);self.assertFalse(front[60,60])
        edited=ref.copy();edited[40:50,35:85]=skin;edited[50:64,45:75]=[40,10,10]   # the edit shaved it and opened the mouth
        closed=np.zeros((h,w),bool);closed[54:58,45:75]=True
        region,hair=m.mouth_open_region(ref,edited,cavity,[0,0,w,h],support,model,True,closed,None,front)
        self.assertFalse(region[51,60]);self.assertFalse(region[45,60]);self.assertTrue(region[60,60])
        self.assertTrue(hair[51,60])

    def test_a_beard_around_the_mouth_does_not_cover_the_opening(self):
        # Moustache and chin beard join beside the mouth and enclose it: the hole they
        # enclose is the mouth, not a gap between strands, so the opening stays open.
        h=w=120;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin
        ref[38:50,30:90]=[90,80,75];ref[50:80,30:40]=[90,80,75];ref[50:80,80:90]=[90,80,75];ref[68:80,30:90]=[90,80,75]
        cavity=np.zeros((h,w),bool);cavity[54:64,48:72]=True
        support=np.ones((h,w),bool);model={'median':skin.astype(np.float32),'tolerance':30.}
        front=m.front_facial_hair(ref,cavity,[0,0,w,h],support,model,80)
        self.assertTrue(front[44,60]);self.assertTrue(front[60,35])
        self.assertFalse(front[60,60]);self.assertFalse(front[62,50])



    def test_open_mouth_with_facial_hair_never_shows_shaven_skin_or_restyled_beard(self):
        h=w=120;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin
        ref[52:63,45:75]=[180,100,100]                                           # closed lips
        ref[70:73,50:70]=skin-[28,28,28]                                         # faint stubble below the lips
        edited=ref.copy();edited[50:64,45:75]=[40,10,10];edited[64:68,45:75]=[190,90,90]
        edited[70:73,50:70]=skin                                                 # the edit shaves the stubble
        edited[68:100,30:90][edited[68:100,30:90].sum(axis=2)==int(skin.sum())]=[120,90,70]   # and repaints the chin far below
        edited[70:73,50:70]=skin
        cavity=np.zeros((h,w),bool);cavity[50:64,45:75]=True
        closed=np.zeros((h,w),bool);closed[52:63,45:75]=True
        support=np.ones((h,w),bool);model={'median':skin.astype(np.float32),'tolerance':30.}
        region,hair=m.mouth_open_region(ref,edited,cavity,[0,0,w,h],support,model,True,closed)
        self.assertTrue(region[56,60]);self.assertTrue(region[66,60])
        self.assertFalse(region[71,60])                                          # no shaven skin
        self.assertFalse(region[95,60])                                          # the chin beyond the lips stays the source

    def test_closed_eye_covers_the_whole_eye_and_skips_painted_strands(self):
        h=w=80;skin=np.array([210,160,130],np.uint8)
        ref=np.zeros((h,w,3),np.uint8);ref[:]=skin;ref[30:40,25:55]=[250,250,250]
        eye=np.zeros((h,w,4),np.uint8);eye[30:40,25:55]=[250,250,250,255];eye[40,25:55]=[250,250,250,20]   # soft lower rim
        edited=ref.copy();edited[30:40,25:55]=skin;edited[35,25:55]=[30,20,20]                             # closed lid line
        edited[28:31,56:60]=[200,40,160]                                                                     # a strand the edit painted
        layers={'face':np.dstack([ref,np.full((h,w),255,np.uint8)]),'eyewhite-l':eye}
        region=m.eye_close_region(layers,ref,edited,'l',np.ones((h,w),bool),{'median':skin.astype(np.float32),'tolerance':30.})
        self.assertTrue(region[41,40]);self.assertFalse(region[29,58])




    def test_crossed_legs_are_split_by_the_nearest_knee(self):
        legs=np.zeros((100,100,4),np.uint8);legs[20:95,20:80]=[50,50,120,255]
        points={'hipL':[55,20],'kneeL':[57,55],'ankleL':[60,90],'hipR':[45,20],'kneeR':[30,50],'ankleR':[70,70]}
        layers={'legwear':legs};m.split_limbs(layers,points)
        for side in ['l','r']:
            import cv2
            count,_=cv2.connectedComponents((layers['legwear-'+side][:,:,3]>0).astype(np.uint8))
            self.assertEqual(count-1,1)








    def test_skin_model_falls_back_to_face_pixels_that_match_the_source(self):
        skin=np.array([200,150,120],np.uint8)
        face=np.zeros((60,60,4),np.uint8);face[5:55,5:55]=list(skin)+[255]
        glasses=np.zeros_like(face);glasses[0:60,0:60]=[200,200,220,40]    # a faint lens over the whole face
        ref=np.zeros((60,60,3),np.uint8);ref[:]=skin
        model=m.skin_model(ref,{'face':face,'eyewear':glasses},np.full((60,60),255,np.uint8),np.ones((60,60),bool))
        self.assertIsNotNone(model);self.assertLess(m.color_distance(model['median'],skin),2)



    def test_a_mislabeled_limb_layer_far_from_the_shoulder_is_not_evidence(self):
        h=w=200;mask=np.zeros((h,w),np.uint8);mask[20:190,40:160]=255
        eye=np.zeros((h,w,4),np.uint8)
        layers={'eyewhite-l':eye.copy(),'eyewhite-r':eye.copy()}
        layers['eyewhite-l'][30:34,104:112,3]=255;layers['eyewhite-r'][30:34,88:96,3]=255
        skirt=np.zeros((h,w,4),np.uint8);skirt[150:190,100:160,3]=255
        layers['handwear-r']=skirt
        n=lambda x,y,c=.8:{'x':x/w,'y':y/h,'confidence':c}
        points={'eyeL':n(108,32),'eyeR':n(92,32),'shoulderR':n(70,60),'elbowR':n(55,80),'wristR':n(50,40)}
        out,records=m.verify_landmarks(layers,mask,points,(w,h),(w,h))
        self.assertIsNotNone(out['wristR']);self.assertIsNotNone(out['elbowR'])












    def test_low_confidence_points_are_verified_only_on_decomposition_evidence(self):
        h=w=200;mask=np.zeros((h,w),np.uint8);mask[10:190,30:170]=255
        layers={}
        for side,x in [('l',108),('r',92)]:
            e=np.zeros((h,w,4),np.uint8);e[30:34,x-4:x+4,3]=255;layers['eyewhite-'+side]=e
        mouth=np.zeros((h,w,4),np.uint8);mouth[58:62,94:106,3]=255;layers['mouth']=mouth
        arm=np.zeros((h,w,4),np.uint8);arm[60:140,52:64,3]=255;layers['handwear-r']=arm    # a straight hanging arm
        n=lambda x,y,c:{'x':x/w,'y':y/h,'confidence':c}
        points={'eyeL':n(108,32,.8),'eyeR':n(92,32,.8),'mouth':n(101,61,.42),'shoulderR':n(58,62,.7),'elbowR':n(58,100,.4),'wristR':n(58,135,.6),
                'shoulderL':n(140,62,.7),'elbowL':n(150,100,.4),'wristL':n(150,135,.6)}
        out,records=m.verify_landmarks(layers,mask,points,(w,h),(w,h))
        self.assertTrue(out['mouth'].get('verified'));self.assertTrue(out['elbowR'].get('verified'))
        self.assertEqual(out['elbowR']['confidence'],.4)        # never raised
        self.assertFalse(out['elbowL'].get('verified',False))   # no arm layer on that side


    def _loose_sleeve_scene(self, touching_forearm=False, cape=False):
        """A front-facing figure whose loose right sleeve touches the torso down to the
        elbow and hangs free below it, with the shoulder seam hidden."""
        h=w=300;green=[40,120,50]
        mask=np.zeros((h,w),np.uint8);ref=np.full((h,w,3),255,np.uint8)
        arm=np.zeros((h,w,4),np.uint8);arm[70:230,70:106]=green+[255]
        torso=np.zeros((h,w,4),np.uint8);torso[80:260,112:190]=green+[255];torso[80:150,106:112]=green+[255]
        if touching_forearm:torso[150:260,106:112]=green+[255]
        layers={'handwear-r':arm,'topwear':torso}
        for side,x in [('l',160),('r',140)]:
            e=np.zeros((h,w,4),np.uint8);e[28:32,x-3:x+3]=[250,250,250,255];layers['eyewhite-'+side]=e
        for layer in (arm,torso):
            mask[layer[:,:,3]>0]=255;ref[layer[:,:,3]>0]=layer[layer[:,:,3]>0][:,:3]
        mask[20:40,130:170]=255
        if cape:ref[70:115,70:106]=[230,220,200]   # a capelet over the shoulder, within the arm outline
        n=lambda x,y,c:{'x':x/w,'y':y/h,'confidence':c}
        points={'shoulderR':n(88,84,.6),'elbowR':n(88,150,.42),'wristR':n(88,225,.7),'hipR':n(130,250,.6),'kneeR':n(130,280,.6),'ankleR':n(130,298,.6)}
        regions={'Arm R':{'visible':True,'separate':True,'rootOccluded':True,'reason':'Loose sleeve hides the shoulder'},
                 'Leg R':{'visible':True,'separate':True,'rootOccluded':True,'reason':'Hem hides the hip'}}
        return layers,mask,ref,points,regions,(w,h)

    def test_occluded_shoulder_of_a_free_hanging_loose_sleeve_is_estimated(self):
        layers,mask,ref,points,regions,size=self._loose_sleeve_scene()
        out,records,estimates=m.estimate_separated_shoulders(layers,mask,ref,points,regions,size,size)
        self.assertEqual(estimates['Arm R']['status'],'estimated')
        self.assertEqual(estimates['Arm R']['reason'],m.SHOULDER_ESTIMATE_REASON)
        s=out['shoulderR'];self.assertTrue(s['verified']);self.assertEqual(s['confidence'],.6)   # never raised
        # Half an upper-arm width (36 px) below the arm layer's top (y 70), on the arm axis.
        self.assertAlmostEqual(s['y']*300,88,delta=4);self.assertAlmostEqual(s['x']*300,88,delta=3)
        self.assertTrue(out['elbowR']['verified']);self.assertEqual(out['elbowR']['confidence'],.42)
        self.assertNotIn('Leg R',estimates);self.assertEqual(out['hipR'],points['hipR'])   # legs are never estimated

    def test_shoulder_is_not_estimated_under_a_cape_against_the_torso_or_without_occlusion(self):
        layers,mask,ref,points,regions,size=self._loose_sleeve_scene(cape=True)
        out,_,estimates=m.estimate_separated_shoulders(layers,mask,ref,points,regions,size,size)
        self.assertEqual(estimates['Arm R']['status'],'declined');self.assertIn('covers the shoulder',estimates['Arm R']['reason'])
        self.assertEqual(out['shoulderR'],points['shoulderR'])
        layers,mask,ref,points,regions,size=self._loose_sleeve_scene(touching_forearm=True)
        out,_,estimates=m.estimate_separated_shoulders(layers,mask,ref,points,regions,size,size)
        self.assertEqual(estimates['Arm R']['status'],'declined');self.assertEqual(out['shoulderR'],points['shoulderR'])
        layers,mask,ref,points,regions,size=self._loose_sleeve_scene()
        regions['Arm R']['rootOccluded']=False
        out,records,estimates=m.estimate_separated_shoulders(layers,mask,ref,points,regions,size,size)
        self.assertEqual((estimates,records,out),({},[],points))
        layers,mask,ref,points,regions,size=self._loose_sleeve_scene()
        points['elbowR']['confidence']=.2   # an unverifiable elbow
        self.assertEqual(m.estimate_separated_shoulders(layers,mask,ref,points,regions,size,size)[2]['Arm R']['status'],'declined')

    def _skirt_scene(self, hem=170, coat=False, seat=False, top=140, knee=220):
        """Two separated legs hanging below a skirt that hides their top; See-through
        paints each leg layer up to y 140 under the skirt."""
        h=w=300;skin=[230,190,160];navy=[30,30,90]
        mask=np.zeros((h,w),np.uint8);ref=np.full((h,w,3),255,np.uint8)
        legs=np.zeros((h,w,4),np.uint8);legs[top:290,110:140]=skin+[255];legs[top:290,160:190]=skin+[255]
        if seat:legs[100:150,110:190]=skin+[255]   # trousers painted with their seat, up to the waist
        skirt=np.zeros((h,w,4),np.uint8);skirt[100:hem,90:210]=navy+[255]
        layers={'legwear':legs,'bottomwear':skirt}
        if coat:
            tail=np.zeros((h,w,4),np.uint8);tail[100:260,192:206]=navy+[255];layers['topwear']=tail   # a coat tail beside the left thigh
        for side,x in [('l',160),('r',140)]:
            e=np.zeros((h,w,4),np.uint8);e[28:32,x-3:x+3]=[250,250,250,255];layers['eyewhite-'+side]=e
        for name in ['legwear','bottomwear','topwear']:
            if name in layers:
                a=layers[name][:,:,3]>0;mask[a]=255;ref[a]=layers[name][a][:,:3]
        mask[20:40,130:170]=255
        n=lambda x,y,c:{'x':x/w,'y':y/h,'confidence':c}
        points={'hipL':n(175,120,.45),'kneeL':n(175,knee,.7),'ankleL':n(175,285,.7),'hipR':n(125,120,.45),'kneeR':n(125,knee,.7),'ankleR':n(125,285,.7)}
        regions={s:{'visible':True,'separate':True,'rootOccluded':True,'reason':'The skirt hides the hip'} for s in ['Leg L','Leg R']}
        return layers,mask,ref,points,regions,(w,h)

    def test_hip_hidden_by_a_skirt_is_estimated_from_the_leg_layer(self):
        layers,mask,ref,points,regions,size=self._skirt_scene()
        out,records,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        for side,x in [('L',175),('R',125)]:
            e=estimates['Leg '+side];self.assertEqual(e['status'],'estimated');self.assertEqual(e['reason'],m.HIP_ESTIMATE_REASON)
            hip=out['hip'+side];self.assertTrue(hip['verified']);self.assertEqual(hip['confidence'],.45)   # never raised
            # The top of the leg layer (y 140), on the thigh axis.
            self.assertAlmostEqual(hip['y']*300,140,delta=2);self.assertAlmostEqual(hip['x']*300,x,delta=2)
            self.assertEqual(out['knee'+side],points['knee'+side])
        self.assertEqual(sorted(r['point'] for r in records),['hipL','hipR'])
        # A longer skirt hiding over half of the thigh: still estimated, with the hidden share recorded.
        layers,mask,ref,points,regions,size=self._skirt_scene(hem=190)
        estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)[2]
        self.assertEqual({e['status'] for e in estimates.values()},{'estimated'});self.assertGreater(estimates['Leg L']['hiddenThigh'],.5)

    def test_hip_above_a_leg_layer_that_ends_under_the_skirt_is_taken_on_the_thigh_axis(self):
        # See-through ends the leg layer at y 160, under the skirt: its top gives an implausibly
        # short thigh. The hip lies further up the same axis, under the skirt, at the answered height.
        layers,mask,ref,points,regions,size=self._skirt_scene(hem=180,top=160,knee=200)
        out,_,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        for side,x in [('L',175),('R',125)]:
            e=estimates['Leg '+side];self.assertEqual(e['status'],'estimated');self.assertLess(e['layerTopToShin'],.6)
            self.assertAlmostEqual(out['hip'+side]['y']*300,120,delta=3);self.assertAlmostEqual(out['hip'+side]['x']*300,x,delta=3)
        # Above the skirt the answered hip is not hidden: no extension, the estimate is declined.
        layers,mask,ref,points,regions,size=self._skirt_scene(hem=180,top=160,knee=200)
        for s_ in ('hipL','hipR'):points[s_]['y']=90/300
        estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)[2]
        self.assertEqual({e['status'] for e in estimates.values()},{'declined'})

    def test_hip_is_not_estimated_under_a_gown_beside_a_coat_tail_for_crossed_legs_or_without_occlusion(self):
        # A gown down to the ankles: no thigh or knee is visible below the hem.
        layers,mask,ref,points,regions,size=self._skirt_scene(hem=280)
        out,_,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        self.assertEqual({e['status'] for e in estimates.values()},{'declined'});self.assertEqual(out,points)
        # A coat tail hanging beside the left thigh.
        layers,mask,ref,points,regions,size=self._skirt_scene(coat=True)
        _,_,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        self.assertEqual(estimates['Leg L']['status'],'declined');self.assertEqual(estimates['Leg R']['status'],'estimated')
        # Trousers painted with their seat: the pivot is the crotch (y 150), which the skirt hides.
        layers,mask,ref,points,regions,size=self._skirt_scene(seat=True)
        out,_,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        self.assertAlmostEqual(out['hipL']['y']*300,150,delta=3)
        # The same trousers under a shorter top: the seat shows at the crotch, and moving one leg would tear it.
        layers,mask,ref,points,regions,size=self._skirt_scene(hem=125,seat=True)
        out,_,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        self.assertEqual({e['status'] for e in estimates.values()},{'declined'});self.assertEqual(out,points)
        # Crossed legs, an unseparated leg, a hidden knee, or no occlusion.
        layers,mask,ref,points,regions,size=self._skirt_scene()
        points['kneeL'],points['kneeR']=points['kneeR'],points['kneeL']
        self.assertIn('cross',m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)[2]['Leg L']['reason'])
        layers,mask,ref,points,regions,size=self._skirt_scene()
        regions['Leg L']['separate']=False;regions['Leg R']['rootOccluded']=False;points['kneeR']['confidence']=.4
        out,records,estimates=m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)
        self.assertEqual((estimates,records,out),({},[],points))
        layers,mask,ref,points,regions,size=self._skirt_scene()
        points['kneeL']['confidence']=.4
        self.assertEqual(m.estimate_covered_hips(layers,mask,ref,points,regions,size,size)[2]['Leg L']['status'],'declined')

    def test_garment_mode_verifies_a_lower_confidence_chin_and_shoulders_on_the_decomposition(self):
        h=w=200;mask=np.zeros((h,w),np.uint8);mask[10:190,30:170]=255
        layers={}
        for side,x in [('l',108),('r',92)]:
            e=np.zeros((h,w,4),np.uint8);e[30:34,x-4:x+4,3]=255;layers['eyewhite-'+side]=e
        mouth=np.zeros((h,w,4),np.uint8);mouth[50:54,94:106,3]=255;layers['mouth']=mouth
        face=np.zeros((h,w,4),np.uint8);face[15:66,80:120,3]=255;layers['face']=face   # jaw at y 65
        n=lambda x,y,c:{'x':x/w,'y':y/h,'confidence':c}
        points={'eyeL':n(108,32,.85),'eyeR':n(92,32,.85),'mouth':n(100,52,.75),'chin':n(100,63,.7),'shoulderL':n(130,80,.72),'shoulderR':n(70,80,.72)}
        out,records=m.verify_landmarks(layers,mask,points,(w,h),(w,h),minimum=.8,garment=True)
        for name in ['mouth','chin','shoulderL','shoulderR']:self.assertTrue(out[name].get('verified'),name)
        self.assertAlmostEqual(out['chin']['y']*h,65,delta=1);self.assertEqual(out['chin']['confidence'],.7)
        # Not in the visible-limbs check, and not for a chin far from the jaw or a shoulder off the silhouette.
        out,_=m.verify_landmarks(layers,mask,points,(w,h),(w,h))
        self.assertFalse(out['chin'].get('verified',False))
        far={**points,'chin':n(100,95,.7),'shoulderL':n(180,80,.72)}
        out,_=m.verify_landmarks(layers,mask,far,(w,h),(w,h),minimum=.8,garment=True)
        self.assertFalse(out['chin'].get('verified',False));self.assertFalse(out['shoulderL'].get('verified',False))

    def _composite(self, layers, order):
        col=np.zeros(next(iter(layers.values())).shape[:2]+(3,),np.float32)
        for n in order:
            a=layers[n][:,:,3:].astype(np.float32)/255;col=layers[n][:,:,:3]*a+col*(1-a)
        return col






if __name__=='__main__':unittest.main()
