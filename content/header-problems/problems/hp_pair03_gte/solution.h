// Reference solution: lexicographic >=. The first component decides when it
// differs; on a tie the second component decides, and there the comparison is
// NON-strict, which is what makes two equal pairs return true.
//
// Only the components' own < is used, so this works for every T1/T2 the
// grader instantiates — including std::string, which has < but not >=.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::operator>=(const CP::pair<T1, T2> &other) const
{
  // Your code here
  if (other.first < first)
    return true;
  if (first < other.first)
    return false;
  return !(second < other.second);
}

template <typename T1, typename T2>
void CP::pair<T1, T2>::clamp_low(const CP::pair<T1, T2> &floor)
{
  // You MAY need to edit this function
  if (!(*this >= floor))
  {
    first = floor.first;
    second = floor.second;
  }
}

#endif
