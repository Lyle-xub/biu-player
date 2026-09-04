#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface BIUCarrier : NSObject
@property(nonatomic,readonly) NSString *failure;
- (instancetype)initWithPayload:(NSData *)payload snapshot:(NSString *)snapshot;
- (instancetype)initWithSnapshot:(NSString *)snapshot;
- (int)frames;
- (nullable NSData *)grid:(int)index;
- (nullable NSData *)feed:(NSData *)levels;
@end
NS_ASSUME_NONNULL_END
