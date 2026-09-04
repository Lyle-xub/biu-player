#include <jni.h>
#include "Carrier.h"
using namespace biu;
static std::string text(JNIEnv* e,jstring s){const char* p=e->GetStringUTFChars(s,nullptr);std::string v(p);e->ReleaseStringUTFChars(s,p);return v;}
static Bytes bytes(JNIEnv* e,jbyteArray a){Bytes b(e->GetArrayLength(a));e->GetByteArrayRegion(a,0,b.size(),(jbyte*)b.data());return b;}
static jbyteArray array(JNIEnv* e,const uint8_t* p,size_t n){auto a=e->NewByteArray(n);e->SetByteArrayRegion(a,0,n,(const jbyte*)p);return a;}
#define CATCH(value) catch(const std::exception& x){e->ThrowNew(e->FindClass("java/lang/IllegalStateException"),x.what());return value;}
extern "C" {
JNIEXPORT jlong JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_encoder(JNIEnv* e,jobject,jbyteArray b,jstring s){try{return (jlong)new Encoder(bytes(e,b),text(e,s));}CATCH(0)}
JNIEXPORT jint JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_frames(JNIEnv*,jobject,jlong p){return ((Encoder*)p)->frames();}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_grid(JNIEnv* e,jobject,jlong p,jint i){try{auto g=((Encoder*)p)->grid(i);return array(e,g.data(),g.size());}CATCH(nullptr)}
JNIEXPORT void JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_freeEncoder(JNIEnv*,jobject,jlong p){delete (Encoder*)p;}
JNIEXPORT jlong JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_decoder(JNIEnv* e,jobject,jstring s){try{return (jlong)new Decoder(text(e,s));}CATCH(0)}
JNIEXPORT jbyteArray JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_feed(JNIEnv* e,jobject,jlong p,jbyteArray a){try{auto b=bytes(e,a);if(b.size()!=W*H)return nullptr;Grid g;std::copy(b.begin(),b.end(),g.begin());auto d=(Decoder*)p;if(!d->feed(g))return nullptr;return array(e,d->payload.data(),d->payload.size());}CATCH(nullptr)}
JNIEXPORT void JNICALL Java_expo_modules_biuvideocloud_BiuVideoCloudModule_freeDecoder(JNIEnv*,jobject,jlong p){delete (Decoder*)p;}
}
