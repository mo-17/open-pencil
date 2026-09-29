export const mobileRecordedAt = '2026-09-16T00:00:00.000Z'
export const mobileId = (value: number) =>
  '00000000-0000-4000-8000-' + String(value).padStart(12, '0')

export const mobileDishes = [
  {
    id: mobileId(40),
    title: '松露菌菇拌面',
    category: '主厨推荐',
    description: '鲜香菌菇与手作面条，拌入清爽松露酱汁。',
    image_url: '',
    price: 3200,
    available: true,
    version: 0,
    created_at: mobileRecordedAt
  },
  {
    id: mobileId(41),
    title: '炭火照烧鸡腿饭',
    category: '人气主食',
    description: '现烤鸡腿搭配温热米饭，佐以时令蔬菜。',
    image_url: '',
    price: 3800,
    available: true,
    version: 0,
    created_at: mobileRecordedAt
  }
]

export const mobileProduct = {
  id: mobileId(20),
  store_id: mobileId(30),
  title: '日常手作陶瓷杯',
  content: 'Capture a thought. Give it room to grow.\nCome back whenever you need.',
  price: 2400,
  stock: 12,
  active: true
}
