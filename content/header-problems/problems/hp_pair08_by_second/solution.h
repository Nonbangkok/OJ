// Reference solution: the SECOND component is the primary key and the first
// one only breaks ties. Both comparisons are strict, so two pairs that are
// equal in both components give false in each direction — which is what the
// merge sort in the grader needs to stay stable.
#ifndef _STUDENT_H_INCLUDED
#define _STUDENT_H_INCLUDED
#include "pair.h"
using namespace std;

template <typename T1, typename T2>
bool CP::pair<T1, T2>::less_by_second(const CP::pair<T1, T2> &other) const
{
  // Your code here
  if (second < other.second)
    return true;
  if (other.second < second)
    return false;
  return first < other.first;
}

template <typename T1, typename T2>
bool CP::pair<T1, T2>::greater_by_second(const CP::pair<T1, T2> &other) const
{
  // You MAY need to edit this function
  return other.less_by_second(*this);
}

#endif
